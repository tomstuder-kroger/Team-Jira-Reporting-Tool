import fs from 'node:fs'
import path from 'node:path'
import { ConfigError, JiraError, SetupError } from './errors.mjs'
import { configPath, readConfig } from './config.mjs'
import { createJiraClient } from './jira.mjs'
import { checkLocal, makeSend, readJson } from './guard.mjs'

const MAX_ROSTER = 40
const MAX_NAME = 120

/** Validates a roster from the page. Returns the clean list of { jiraName }, or throws ConfigError. */
export function cleanRoster(input) {
  if (!Array.isArray(input) || input.length === 0) throw new ConfigError('The roster cannot be empty.')
  if (input.length > MAX_ROSTER) throw new ConfigError(`The roster can hold at most ${MAX_ROSTER} designers.`)
  const seen = new Set()
  const out = []
  for (const r of input) {
    const name = typeof r?.jiraName === 'string' ? r.jiraName.replace(/\s+/g, ' ').trim() : ''
    if (!name) throw new ConfigError('Every roster entry needs a name.')
    if (name.length > MAX_NAME) throw new ConfigError('A roster name is too long.')
    if (/[\u0000-\u001f"\\]/.test(name)) throw new ConfigError(`"${name.slice(0, 30)}" contains a character that is not allowed.`)
    if (seen.has(name)) throw new ConfigError(`${name} is listed twice.`)
    seen.add(name)
    out.push({ jiraName: name })
  }
  return out
}

/**
 * Replaces only the roster in config/report.config.json. Keeps a backup of the previous file first,
 * then writes through a temp file and a rename so the config is never half written.
 */
export function saveRoster(root, input) {
  const roster = cleanRoster(input)
  const cfg = readConfig(root) // refuses if there is no local config (the example is never edited)
  const before = new Set(cfg.roster.map((r) => r.jiraName))
  const after = new Set(roster.map((r) => r.jiraName))

  const file = configPath(root)
  fs.copyFileSync(file, file.replace(/\.json$/, '.backup.json'))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...cfg, roster }, null, 2) + '\n')
  fs.renameSync(tmp, file)

  return {
    count: roster.length,
    added: roster.filter((r) => !before.has(r.jiraName)).map((r) => r.jiraName),
    removed: [...before].filter((n) => !after.has(n)),
  }
}

/**
 * Connect-style middleware for the roster page:
 *   GET  /api/roster          the current roster (names only)
 *   PUT  /api/roster          replace the roster
 *   GET  /api/users/search    ?q=text, Jira display names that match
 * Localhost only, same-origin, JSON only. The user search is the only call that reaches Jira.
 */
export function createRosterHandler({ root, env, fetchImpl, minSearchGapMs = 250, clock = () => Date.now() }) {
  let lastSearch = 0

  return async function rosterHandler(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    const isRoster = url.pathname === '/api/roster'
    const isSearch = url.pathname === '/api/users/search'
    if (!isRoster && !isSearch) return next()

    const send = makeSend(res)
    const write = req.method === 'PUT'
    const denied = checkLocal(req, { requireOrigin: write })
    if (denied) return send(denied.code, { ok: false, error: denied.error })

    const allowed = isRoster ? ['GET', 'PUT'] : ['GET']
    if (!allowed.includes(req.method)) {
      res.setHeader('Allow', allowed.join(', '))
      return send(405, { ok: false, error: `Use ${allowed.join(' or ')}.` })
    }

    try {
      if (isRoster && req.method === 'GET') {
        const cfg = readConfig(root)
        return send(200, { ok: true, roster: cfg.roster.map((r) => ({ jiraName: r.jiraName })) })
      }

      if (isRoster) {
        const body = await readJson(req)
        return send(200, { ok: true, ...saveRoster(root, body?.roster) })
      }

      // user search
      const q = (url.searchParams.get('q') ?? '').trim()
      if (q.length < 2) return send(200, { ok: true, people: [] })
      if (q.length > 60) return send(400, { ok: false, error: 'Search text is too long.' })
      const now = clock()
      if (now - lastSearch < minSearchGapMs) return send(429, { ok: false, error: 'Searching too fast. Wait a moment.' })
      lastSearch = now

      if (!env.JIRA_EMAIL || !env.JIRA_API_TOKEN) throw new SetupError('Jira credentials are not set. Add JIRA_EMAIL and JIRA_API_TOKEN to .env, then restart npm start.')
      const cfg = readConfig(root)
      const client = createJiraClient({ email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN, cloudId: env.JIRA_CLOUD_ID || cfg.cloudId, fetchImpl })
      return send(200, { ok: true, people: await client.searchUsers(q) })
    } catch (err) {
      if (err && typeof err.code === 'number' && typeof err.error === 'string') return send(err.code, { ok: false, error: err.error })
      if (err instanceof SetupError) return send(503, { ok: false, error: err.message })
      if (err instanceof ConfigError) return send(400, { ok: false, error: err.message })
      if (err instanceof JiraError) return send(502, { ok: false, error: err.message })
      console.error('[roster] unexpected error:', err?.message ?? err)
      return send(500, { ok: false, error: 'The request failed unexpectedly. The terminal running npm start has details.' })
    }
  }
}
