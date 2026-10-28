// Calls to the local roster endpoints (server/roster.mjs). Names only: the server never sends emails or IDs.

async function call(url, init) {
  let res
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error('Could not reach the local service. Is npm start running?')
  }
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || (res.status === 404 ? 'The roster service is not running. Start the app with npm start.' : `Request failed (${res.status}).`))
  }
  return body
}

export const fetchRoster = async () => (await call('/api/roster', { headers: { Accept: 'application/json' }, cache: 'no-store' })).roster.map((r) => r.jiraName)

export const searchPeople = async (q, signal) =>
  (await call(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, signal })).people.map((p) => p.displayName)

export const saveRoster = (names) =>
  call('/api/roster', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ roster: names.map((jiraName) => ({ jiraName })) }),
  })

// The page reloads after a save so every view picks up the new roster. This carries the result across.
const KEY = 'dar.rosterSaved'
export function rememberSaved(result) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ added: result.added, removed: result.removed, count: result.count })) } catch { /* ignore */ }
}
export function takeSaved() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY))
    sessionStorage.removeItem(KEY)
    if (v && Array.isArray(v.added) && Array.isArray(v.removed)) return v
  } catch { /* ignore */ }
  return null
}
