import { JiraError } from './errors.mjs'

const MAX_PAGES = 20
const PAGE_SIZE = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Plain-language message for a failed Jira call. Never includes request headers or the token. */
export function describeStatus(status, body) {
  if (status === 400) {
    const detail = String(body?.errorMessages?.[0] ?? '').slice(0, 200)
    return `Jira rejected the search (400).${detail ? ` ${detail}` : ''} A name or project in config/report.config.json may be wrong.`
  }
  if (status === 401) return 'Jira rejected the email or API token (401). Check JIRA_EMAIL and JIRA_API_TOKEN in .env.'
  if (status === 403) return 'Jira refused the request (403). The token may lack read access, or a Kroger policy blocks API tokens.'
  if (status === 404) return 'Jira could not find the site (404). Check JIRA_CLOUD_ID.'
  if (status === 429) return 'Jira is rate limiting requests (429). Wait a minute and try again.'
  if (status >= 500) return `Jira is having problems (${status}). Try again shortly.`
  return `Jira returned an unexpected response (${status}).`
}

/** Read-only Jira client. Only POST /rest/api/3/search/jql, which reads. */
export function createJiraClient({ email, token, cloudId, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  if (!UUID.test(cloudId ?? '')) throw new JiraError('JIRA_CLOUD_ID is not a valid cloud ID.')
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
  const base = `https://api.atlassian.com/ex/jira/${cloudId}`

  async function post(path, payload) {
    let res
    try {
      res = await fetchImpl(base + path, {
        method: 'POST',
        headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new JiraError(`Jira did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)
      }
      throw new JiraError('Could not reach Jira. Check your network or VPN.')
    }
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    if (!res.ok) throw new JiraError(describeStatus(res.status, body), res.status)
    if (!body || typeof body !== 'object') throw new JiraError('Jira returned a response that was not JSON.', res.status)
    return body
  }

  /** Every issue matching the JQL, following nextPageToken. Fails rather than returning a partial list. */
  async function searchAll(jql, fields) {
    const issues = []
    let nextPageToken
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await post('/rest/api/3/search/jql', {
        jql,
        fields,
        maxResults: PAGE_SIZE,
        ...(nextPageToken ? { nextPageToken } : {}),
      })
      if (!Array.isArray(body.issues)) throw new JiraError('Jira returned a search result without an issues list.')
      issues.push(...body.issues)
      if (body.isLast === true) return issues
      if (!body.nextPageToken) {
        if (body.isLast === false) throw new JiraError('Jira said there were more results but gave no way to fetch them.')
        return issues
      }
      nextPageToken = body.nextPageToken
    }
    throw new JiraError(`Jira returned more than ${MAX_PAGES * PAGE_SIZE} tickets. Narrow the roster or projects in config.`)
  }

  return { searchAll }
}
