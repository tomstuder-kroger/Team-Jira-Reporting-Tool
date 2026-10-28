import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import cfg from '../config/report.config.example.json'
import { createRosterHandler, cleanRoster, saveRoster } from './roster.mjs'
import { createJiraClient } from './jira.mjs'

const CLOUD = '00000000-0000-4000-8000-000000000000'
const TOKEN = 'SECRET-TOKEN-VALUE'
const env = { JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: TOKEN, JIRA_CLOUD_ID: CLOUD }
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const GOOD = { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }

// A fake Jira user: includes the fields that must never reach the page.
const person = (displayName, over = {}) => ({
  self: 'https://example.atlassian.net/rest/api/3/user?accountId=abc', accountId: '5b10-secret-id', accountType: 'atlassian',
  emailAddress: 'someone@example.com', avatarUrls: { '48x48': 'https://example.com/a.png' }, displayName, active: true, ...over,
})

const mkRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-roster-'))
  fs.mkdirSync(path.join(root, 'config'))
  fs.writeFileSync(path.join(root, 'config/report.config.json'), JSON.stringify(cfg, null, 2))
  return root
}
const readCfg = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/report.config.json'), 'utf8'))

const call = async (handler, { method = 'GET', url = '/api/roster', headers = { host: '127.0.0.1:5173' }, body } = {}) => {
  const req = Object.assign(new PassThrough(), { method, url, headers })
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b ? JSON.parse(b) : null } }
  let nexted = false
  const done = handler(req, res, () => { nexted = true })
  if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body))
  else req.end()
  await done
  return { res, nexted }
}

describe('cleanRoster', () => {
  it('trims names and collapses spaces, turning a newline or tab into a single space', () => {
    expect(cleanRoster([{ jiraName: '  Doe,   Jamie ' }])).toEqual([{ jiraName: 'Doe, Jamie' }])
    expect(cleanRoster([{ jiraName: 'Doe,\nJamie\t' }])).toEqual([{ jiraName: 'Doe, Jamie' }])
  })
  it('rejects empty, duplicate, non-string, over-long, too many, and quote or control characters', () => {
    expect(() => cleanRoster([])).toThrow(/empty/)
    expect(() => cleanRoster('x')).toThrow(/empty/)
    expect(() => cleanRoster([{ jiraName: 'A, A' }, { jiraName: 'A, A' }])).toThrow(/twice/)
    expect(() => cleanRoster([{ jiraName: 5 }])).toThrow(/needs a name/)
    expect(() => cleanRoster([{ jiraName: '   ' }])).toThrow(/needs a name/)
    expect(() => cleanRoster([{ jiraName: 'x'.repeat(200) }])).toThrow(/too long/)
    expect(() => cleanRoster(Array.from({ length: 41 }, (_, i) => ({ jiraName: `N${i}, X` })))).toThrow(/at most/)
    expect(() => cleanRoster([{ jiraName: 'Bad"Name' }])).toThrow(/not allowed/)
    expect(() => cleanRoster([{ jiraName: 'Bad\u0007Name' }])).toThrow(/not allowed/)
  })
  it('keeps "(NonEmp)" and apostrophes exactly', () => {
    expect(cleanRoster([{ jiraName: "O'Neil, Pat (NonEmp)" }])).toEqual([{ jiraName: "O'Neil, Pat (NonEmp)" }])
  })
})

describe('saveRoster', () => {
  it('changes only the roster, keeps every other key, and reports who was added and removed', () => {
    const root = mkRoot()
    const keep = cfg.roster[0].jiraName
    const out = saveRoster(root, [{ jiraName: keep }, { jiraName: 'New, Nia' }])
    expect(out).toEqual({ count: 2, added: ['New, Nia'], removed: cfg.roster.slice(1).map((r) => r.jiraName) })
    const saved = readCfg(root)
    expect(saved.roster).toEqual([{ jiraName: keep }, { jiraName: 'New, Nia' }])
    const { roster: _a, ...restSaved } = saved
    const { roster: _b, ...restOld } = cfg
    expect(restSaved).toEqual(restOld)
  })

  it('writes a backup of the previous file and leaves no temp file', () => {
    const root = mkRoot()
    saveRoster(root, [{ jiraName: 'Only, One' }])
    expect(JSON.parse(fs.readFileSync(path.join(root, 'config/report.config.backup.json'), 'utf8')).roster).toEqual(cfg.roster)
    expect(fs.readdirSync(path.join(root, 'config')).sort()).toEqual(['report.config.backup.json', 'report.config.json'])
  })

  it('refuses when there is no local config, and does not create one', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-empty-'))
    fs.mkdirSync(path.join(root, 'config'))
    expect(() => saveRoster(root, [{ jiraName: 'A, A' }])).toThrow(/missing/)
    expect(fs.readdirSync(path.join(root, 'config'))).toEqual([])
  })

  it('leaves the file untouched when validation fails', () => {
    const root = mkRoot()
    const before = fs.readFileSync(path.join(root, 'config/report.config.json'), 'utf8')
    expect(() => saveRoster(root, [])).toThrow()
    expect(fs.readFileSync(path.join(root, 'config/report.config.json'), 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(root, 'config/report.config.backup.json'))).toBe(false)
  })
})

describe('Jira client searchUsers', () => {
  const make = (fetchImpl) => createJiraClient({ email: 'a@b.c', token: TOKEN, cloudId: CLOUD, fetchImpl })

  it('returns display names only, for active real accounts, and reads without a body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, [
      person('Snow, Sam'), person('Gone, Gail', { active: false }), person('Bot, App', { accountType: 'app' }), person('   ', {}), null,
    ]))
    const out = await make(fetchImpl).searchUsers('sn ow')
    expect(out).toEqual([{ displayName: 'Snow, Sam' }])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3/user/search?query=sn%20ow&maxResults=10`)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('fails plainly on an unexpected shape or an error status, without the token', async () => {
    await expect(make(vi.fn().mockResolvedValue(json(200, { nope: 1 }))).searchUsers('ab')).rejects.toThrow(/does not understand/)
    await expect(make(vi.fn().mockResolvedValue(json(401, {}))).searchUsers('ab')).rejects.toThrow(/email or API token/)
  })
})

describe('roster endpoints', () => {
  const handler = (over = {}) => createRosterHandler({ root: mkRoot(), env, fetchImpl: vi.fn().mockResolvedValue(json(200, [person('Snow, Sam')])), minSearchGapMs: 0, ...over })

  it('passes other paths through', async () => {
    expect((await call(handler(), { url: '/data/report.json' })).nexted).toBe(true)
  })

  it('GET /api/roster returns names only', async () => {
    const { res } = await call(handler())
    expect(res.statusCode).toBe(200)
    expect(res.body.roster).toEqual(cfg.roster.map((r) => ({ jiraName: r.jiraName })))
  })

  it('rejects foreign hosts and origins on every endpoint without calling Jira', async () => {
    const fetchImpl = vi.fn()
    const h = handler({ fetchImpl })
    for (const url of ['/api/roster', '/api/users/search?q=snow']) {
      expect((await call(h, { url, headers: { host: 'evil.example.com' } })).res.statusCode).toBe(403)
      expect((await call(h, { url, headers: { host: '127.0.0.1:5173', origin: 'https://evil.example.com' } })).res.statusCode).toBe(403)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('PUT needs a same-origin Origin header and a JSON body, and never writes otherwise', async () => {
    const root = mkRoot()
    const before = fs.readFileSync(path.join(root, 'config/report.config.json'), 'utf8')
    const h = createRosterHandler({ root, env, fetchImpl: vi.fn() })
    const body = { roster: [{ jiraName: 'X, Xi' }] }
    expect((await call(h, { method: 'PUT', headers: { host: '127.0.0.1:5173', 'content-type': 'application/json' }, body })).res.statusCode).toBe(403) // no Origin
    expect((await call(h, { method: 'PUT', headers: { ...GOOD, origin: 'https://evil.example.com' }, body })).res.statusCode).toBe(403)
    expect((await call(h, { method: 'PUT', headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'text/plain' }, body: 'x' })).res.statusCode).toBe(415)
    expect((await call(h, { method: 'PUT', headers: GOOD, body: '{not json' })).res.statusCode).toBe(400)
    expect((await call(h, { method: 'PUT', headers: GOOD, body: { roster: [] } })).res.statusCode).toBe(400)
    expect(fs.readFileSync(path.join(root, 'config/report.config.json'), 'utf8')).toBe(before)
  })

  it('PUT saves the roster and answers with who changed', async () => {
    const root = mkRoot()
    const h = createRosterHandler({ root, env, fetchImpl: vi.fn() })
    const keep = cfg.roster[0].jiraName
    const { res } = await call(h, { method: 'PUT', headers: GOOD, body: { roster: [{ jiraName: keep }, { jiraName: 'New, Nia' }] } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, count: 2, added: ['New, Nia'] })
    expect(readCfg(root).roster).toHaveLength(2)
  })

  it('PUT refuses an oversized body', async () => {
    const h = createRosterHandler({ root: mkRoot(), env, fetchImpl: vi.fn() })
    const big = JSON.stringify({ roster: [{ jiraName: 'x'.repeat(100 * 1024) }] })
    expect((await call(h, { method: 'PUT', headers: GOOD, body: big })).res.statusCode).toBe(413)
  })

  it('rejects other methods', async () => {
    const h = handler()
    expect((await call(h, { method: 'POST' })).res.statusCode).toBe(405)
    expect((await call(h, { method: 'PUT', url: '/api/users/search?q=snow', headers: GOOD, body: {} })).res.statusCode).toBe(405)
  })

  it('user search returns display names only: no email, account id or avatar reaches the page', async () => {
    const { res } = await call(handler(), { url: '/api/users/search?q=snow' })
    expect(res.body).toEqual({ ok: true, people: [{ displayName: 'Snow, Sam' }] })
    const raw = JSON.stringify(res.body)
    for (const leak of ['someone@example.com', '5b10-secret-id', 'avatar', 'example.atlassian.net', TOKEN]) expect(raw).not.toContain(leak)
  })

  it('short or empty search text does not call Jira; very long text is refused', async () => {
    const fetchImpl = vi.fn()
    const h = handler({ fetchImpl })
    expect((await call(h, { url: '/api/users/search?q=s' })).res.body).toEqual({ ok: true, people: [] })
    expect((await call(h, { url: '/api/users/search' })).res.body).toEqual({ ok: true, people: [] })
    expect((await call(h, { url: `/api/users/search?q=${'a'.repeat(61)}` })).res.statusCode).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('slows rapid searches, and says so plainly', async () => {
    let t = 1000
    const h = handler({ minSearchGapMs: 250, clock: () => t })
    expect((await call(h, { url: '/api/users/search?q=snow' })).res.statusCode).toBe(200)
    t += 100
    expect((await call(h, { url: '/api/users/search?q=snow' })).res.statusCode).toBe(429)
    t += 300
    expect((await call(h, { url: '/api/users/search?q=snow' })).res.statusCode).toBe(200)
  })

  it('answers with a setup message when credentials are missing, and a plain 502 when Jira fails', async () => {
    const noCreds = await call(handler({ env: {} }), { url: '/api/users/search?q=snow' })
    expect(noCreds.res.statusCode).toBe(503)
    expect(noCreds.res.body.error).toMatch(/JIRA_EMAIL and JIRA_API_TOKEN/)
    const down = await call(handler({ fetchImpl: vi.fn().mockResolvedValue(json(500, {})) }), { url: '/api/users/search?q=snow' })
    expect(down.res.statusCode).toBe(502)
    expect(JSON.stringify(down.res.body)).not.toContain(TOKEN)
  })
})
