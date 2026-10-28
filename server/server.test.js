import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import cfg from '../config/report.config.example.json'
import { buildQueries, assertConfig } from './queries.mjs'
import { createJiraClient, describeStatus } from './jira.mjs'
import { toPoolRow, refreshReport } from './refresh.mjs'
import { createRefreshHandler } from './api.mjs'
import { writeReport, readReport } from './store.mjs'
import { JiraError } from './errors.mjs'

const CLOUD = '00000000-0000-4000-8000-000000000000'
const TOKEN = 'SECRET-TOKEN-VALUE'
const issue = (key, status, assignee, pair = [], summary = `title ${key}`) => ({
  key,
  fields: {
    summary,
    status: { name: status },
    assignee: assignee ? { displayName: assignee } : null,
    [cfg.pairFieldId]: pair.map((displayName) => ({ displayName })),
    created: '2026-10-01T10:00:00.000-0400',
    updated: '2026-10-27T09:00:00.000-0400',
    resolutiondate: status === 'Closed' ? '2026-10-26T08:00:00.000-0400' : null,
  },
})
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('buildQueries', () => {
  const q = buildQueries(cfg)
  it('searches every roster name by assignee and by the Pair field', () => {
    for (const r of cfg.roster) expect(q.pool).toContain(`"${r.jiraName}"`)
    expect(q.pool).toContain(`assignee IN (`)
    expect(q.pool).toContain(`${cfg.pairJqlField} IN (`)
  })
  it('is one search: open tickets, plus anything resolved inside the history window', () => {
    expect(q.pool).toContain(`(statusCategory != Done OR resolved >= -${cfg.historyDays}d)`)
    expect(Object.keys(q)).toEqual(['pool'])
  })
  it('escapes quotes in names so a name cannot break the query', () => {
    const odd = { ...cfg, roster: [{ jiraName: 'O"Brien, Pat' }] }
    expect(buildQueries(odd).pool).toContain('"O\\"Brien, Pat"')
  })
  it('rejects bad config instead of building a bad query', () => {
    expect(() => assertConfig({ ...cfg, roster: [] })).toThrow(/empty roster/)
    expect(() => assertConfig({ ...cfg, projects: ['ABC; DROP'] })).toThrow(/project keys/)
    expect(() => assertConfig({ ...cfg, historyDays: 5 })).toThrow(/historyDays/)
    expect(() => assertConfig({ ...cfg, pairJqlField: 'Pair' })).toThrow(/pairJqlField/)
  })
})

describe('Jira client', () => {
  const make = (fetchImpl) => createJiraClient({ email: 'a@b.c', token: TOKEN, cloudId: CLOUD, fetchImpl })

  it('follows nextPageToken until isLast', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { issues: [issue('A-1', 'Open', 'X')], isLast: false, nextPageToken: 'p2' }))
      .mockResolvedValueOnce(json(200, { issues: [issue('A-2', 'Open', 'X')], isLast: true }))
    const out = await make(fetchImpl).searchAll('jql', ['summary'])
    expect(out.map((i) => i.key)).toEqual(['A-1', 'A-2'])
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).nextPageToken).toBe('p2')
  })

  it('sends the token only in the Authorization header, to the gateway, as a read-only search', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { issues: [], isLast: true }))
    await make(fetchImpl).searchAll('jql', ['summary'])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3/search/jql`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from(`a@b.c:${TOKEN}`).toString('base64'))
    expect(init.body).not.toContain(TOKEN)
    expect(url).not.toContain(TOKEN)
  })

  it('fails instead of returning a partial list when a later page errors', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { issues: [issue('A-1', 'Open', 'X')], isLast: false, nextPageToken: 'p2' }))
      .mockResolvedValueOnce(json(500, {}))
    await expect(make(fetchImpl).searchAll('j', [])).rejects.toThrow(/having problems \(500\)/)
  })

  it('fails when Jira says there is more but gives no token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { issues: [], isLast: false }))
    await expect(make(fetchImpl).searchAll('j', [])).rejects.toThrow(/no way to fetch/)
  })

  it('maps failures to plain messages that never contain the token', async () => {
    for (const [status, re] of [[401, /email or API token/], [403, /refused/], [404, /JIRA_CLOUD_ID/], [429, /rate limiting/], [400, /rejected the search/]]) {
      const err = await make(vi.fn().mockResolvedValue(json(status, { errorMessages: ['bad jql'] }))).searchAll('j', []).catch((e) => e)
      expect(err).toBeInstanceOf(JiraError)
      expect(err.message).toMatch(re)
      expect(err.message).not.toContain(TOKEN)
    }
    expect(describeStatus(418, null)).toMatch(/unexpected response \(418\)/)
  })

  it('reports network failure and timeouts without internals', async () => {
    const net = await make(vi.fn().mockRejectedValue(new TypeError('fetch failed'))).searchAll('j', []).catch((e) => e)
    expect(net.message).toMatch(/Could not reach Jira/)
    const slow = Object.assign(new Error('x'), { name: 'TimeoutError' })
    const t = await make(vi.fn().mockRejectedValue(slow)).searchAll('j', []).catch((e) => e)
    expect(t.message).toMatch(/did not answer/)
  })

  it('rejects a malformed cloud id', () => {
    expect(() => createJiraClient({ email: 'a', token: 'b', cloudId: '../evil' })).toThrow(/cloud ID/)
  })
})

describe('toPoolRow', () => {
  it('reads assignee and Pair display names, tolerating missing fields', () => {
    expect(toPoolRow(issue('A-1', 'Open', 'Dev, Dee', ['Roe, Alex']), cfg)).toEqual({ k: 'A-1', t: 'title A-1', s: 'Open', a: 'Dev, Dee', pair: ['Roe, Alex'], c: '2026-10-01T10:00:00.000-0400', u: '2026-10-27T09:00:00.000-0400', r: null })
    expect(toPoolRow(issue('A-3', 'Open', null, [], '  [DESIGN]  spaced   title '), cfg).t).toBe('[DESIGN] spaced title')
    expect(toPoolRow({ key: 'A-2', fields: {} }, cfg)).toEqual({ k: 'A-2', t: '', s: 'Unknown', a: null, pair: [], c: null, u: null, r: null })
  })
})

describe('refreshReport', () => {
  const name = cfg.roster[0].jiraName
  const client = (issues) => ({ searchAll: vi.fn().mockResolvedValueOnce(issues) })
  const now = new Date('2026-11-04T15:00:00.000Z')

  it('makes one search, asks for the date fields, and returns versioned data with a summary', async () => {
    const c = client([issue('X-1', 'Closed', name), issue('X-2', 'Open', name)])
    const { data, summary } = await refreshReport({ cfg, client: c, now })
    expect(c.searchAll).toHaveBeenCalledTimes(1)
    expect(c.searchAll.mock.calls[0][1]).toEqual(expect.arrayContaining(['created', 'updated', 'resolutiondate', cfg.pairFieldId]))
    expect(data.version).toBe(2)
    expect(data.meta.pulledAt).toBe('2026-11-04T15:00:00.000Z')
    expect(data.tickets.map((t) => [t.k, t.r !== null])).toEqual([['X-1', true], ['X-2', false]])
    expect(summary).toMatchObject({ tickets: 2, open: 1, closed: 1, historyDays: cfg.historyDays })
  })

  it('refuses an empty answer so the saved file is not wiped', async () => {
    await expect(refreshReport({ cfg, client: client([]), now })).rejects.toThrow(/returned no tickets/)
  })
})

describe('store', () => {
  it('writes atomically and reads back; a missing file reads as null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-'))
    const file = path.join(dir, 'nested', 'report.json')
    expect(readReport(file)).toBeNull()
    writeReport(file, { a: 1 })
    expect(readReport(file)).toEqual({ a: 1 })
    expect(fs.readdirSync(path.dirname(file))).toEqual(['report.json'])
  })
})

describe('POST /api/refresh handler', () => {
  const mkRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-root-'))
    fs.mkdirSync(path.join(root, 'config'))
    fs.writeFileSync(path.join(root, 'config/report.config.json'), JSON.stringify(cfg))
    return root
  }
  const name = cfg.roster[0].jiraName
  const okFetch = () => vi.fn().mockResolvedValue(json(200, { issues: [issue('X-1', 'Closed', name)], isLast: true }))
  const env = { JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: TOKEN, JIRA_CLOUD_ID: CLOUD }

  const call = async (handler, { method = 'POST', url = '/api/refresh', headers = { host: '127.0.0.1:5173' } } = {}) => {
    const req = Object.assign(new PassThrough(), { method, url, headers })
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b ? JSON.parse(b) : null } }
    let nexted = false
    await handler(req, res, () => { nexted = true })
    return { res, nexted }
  }

  it('passes other paths through', async () => {
    const h = createRefreshHandler({ root: mkRoot(), env, fetchImpl: vi.fn() })
    expect((await call(h, { url: '/data/report.json' })).nexted).toBe(true)
  })

  it('rejects GET, foreign Host headers and foreign Origins without calling Jira', async () => {
    const fetchImpl = vi.fn()
    const h = createRefreshHandler({ root: mkRoot(), env, fetchImpl })
    expect((await call(h, { method: 'GET' })).res.statusCode).toBe(405)
    expect((await call(h, { headers: { host: 'evil.example.com' } })).res.statusCode).toBe(403)
    expect((await call(h, { headers: { host: '127.0.0.1:5173', origin: 'https://evil.example.com' } })).res.statusCode).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes, writes the file, and returns a summary with no credentials in it', async () => {
    const root = mkRoot()
    const h = createRefreshHandler({ root, env, fetchImpl: okFetch() })
    const { res } = await call(h, { headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, tickets: 1, closed: 1, open: 0 })
    expect(JSON.stringify(res.body)).not.toContain(TOKEN)
    expect(readReport(path.join(root, 'public/data/report.json')).tickets).toHaveLength(1)
  })

  it('returns a setup message, not a crash, when credentials are missing', async () => {
    const h = createRefreshHandler({ root: mkRoot(), env: {}, fetchImpl: vi.fn() })
    const { res } = await call(h)
    expect(res.statusCode).toBe(503)
    expect(res.body.error).toMatch(/JIRA_EMAIL and JIRA_API_TOKEN/)
  })

  it('returns 502 with a plain message and leaves the old file when Jira fails', async () => {
    const root = mkRoot()
    writeReport(path.join(root, 'public/data/report.json'), { keep: 'me' })
    const h = createRefreshHandler({ root, env, fetchImpl: vi.fn().mockResolvedValue(json(401, {})) })
    const { res } = await call(h)
    expect(res.statusCode).toBe(502)
    expect(res.body.error).toMatch(/email or API token/)
    expect(readReport(path.join(root, 'public/data/report.json'))).toEqual({ keep: 'me' })
  })

  it('answers a second click inside the cooldown from the first result, with one Jira round trip', async () => {
    const fetchImpl = okFetch()
    const h = createRefreshHandler({ root: mkRoot(), env, fetchImpl, minIntervalMs: 60000 })
    await call(h)
    const second = await call(h)
    expect(second.res.body.skipped).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('shares one Jira call between clicks that overlap', async () => {
    const fetchImpl = okFetch()
    const h = createRefreshHandler({ root: mkRoot(), env, fetchImpl, minIntervalMs: 0 })
    const [a, b] = await Promise.all([call(h), call(h)])
    expect([a.res.statusCode, b.res.statusCode]).toEqual([200, 200])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
