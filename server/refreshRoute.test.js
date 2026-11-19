import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import cfg from '../config/report.config.example.json'
import { chooseRoute, runRefresh } from './run.mjs'
import { createRefreshHandler } from './api.mjs'
import { readReport, writeReport } from './store.mjs'

const mkRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-route-'))
  fs.mkdirSync(path.join(root, 'config'))
  fs.writeFileSync(path.join(root, 'config/report.config.json'), JSON.stringify(cfg))
  return root
}
const row = (k, over = {}) => ({ k, t: `title ${k}`, s: 'In Progress', a: cfg.roster[0].jiraName, pair: [], c: '2026-10-01T10:00:00.000-0400', u: '2026-11-10T09:00:00.000-0500', r: null, y: 'Story', z: null, d: null, sd: null, rk: `0|${k}:`, ...over })
const HIST = [['2026-10-05T10:00:00.000-0400', 'Open', 'In Progress']]

// Fake headless Claude: one ticket in the first project, none in the others.
const fakeMcp = () => vi.fn(async ({ prompt, onUsage }) => {
  onUsage?.({ costUsd: 0.1 })
  if (prompt.includes('"searchResultMode": "count"')) return '[1]'
  if (prompt.includes('listJiraIssueChangelogs')) return JSON.stringify([{ k: 'ABC-1', h: HIST }])
  return JSON.stringify(prompt.includes(`project IN (${cfg.projects[0]})`) ? [row('ABC-1')] : [])
})

describe('chooseRoute', () => {
  it('uses REST when the Jira credentials are present, and the MCP when they are not', () => {
    expect(chooseRoute({ JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 'x' })).toBe('rest')
    expect(chooseRoute({})).toBe('mcp')
    expect(chooseRoute({ JIRA_EMAIL: 'a@b.c' })).toBe('mcp')
  })
  it('lets REFRESH_ROUTE force either one, even with credentials present (a revoked key stays in .env)', () => {
    expect(chooseRoute({ REFRESH_ROUTE: 'mcp', JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 'x' })).toBe('mcp')
    expect(chooseRoute({ REFRESH_ROUTE: 'rest' })).toBe('rest')
    expect(chooseRoute({ REFRESH_ROUTE: 'banana' })).toBe('mcp')
  })
})

describe('runRefresh on the MCP route', () => {
  it('writes report.json from the headless answers and reuses saved history on the next run', async () => {
    const root = mkRoot()
    const mcpRun = fakeMcp()
    const first = await runRefresh({ root, env: {}, mcpRun, now: new Date('2026-11-18T18:00:00Z') })
    expect(first).toMatchObject({ route: 'mcp', tickets: 1, refetched: 1 })
    expect(Number.isInteger(first.seconds) && first.seconds >= 0).toBe(true) // how long the refresh took, for the notice and the terminal line
    const file = path.join(root, 'public/data/report.json')
    expect(readReport(file).tickets[0].h).toEqual([['2026-10-05T14:00:00.000Z', 'Open', 'In Progress']]) // merge writes UTC

    const calls = mcpRun.mock.calls.length
    const second = await runRefresh({ root, env: {}, mcpRun, now: new Date('2026-11-18T19:00:00Z') })
    expect(second.refetched).toBe(0)
    const historyCalls = mcpRun.mock.calls.slice(calls).filter(([a]) => a.prompt.includes('listJiraIssueChangelogs'))
    expect(historyCalls).toHaveLength(0)
  })

  it('does a full pull when the saved file is an unknown version', async () => {
    const root = mkRoot()
    writeReport(path.join(root, 'public/data/report.json'), { version: 2, tickets: [] })
    const out = await runRefresh({ root, env: {}, mcpRun: fakeMcp(), now: new Date('2026-11-18T18:00:00Z') })
    expect(out.refetched).toBe(1)
  })

  it('leaves the saved file alone when the refresh fails', async () => {
    const root = mkRoot()
    const file = path.join(root, 'public/data/report.json')
    writeReport(file, { version: 4, keep: 'me', tickets: [] })
    const failing = vi.fn(async () => { throw new Error('claude exploded') })
    await expect(runRefresh({ root, env: {}, mcpRun: failing })).rejects.toThrow()
    expect(readReport(file).keep).toBe('me')
  })

  it('needs a cloud ID', async () => {
    const root = mkRoot()
    const noCloud = { ...cfg }
    delete noCloud.cloudId
    fs.writeFileSync(path.join(root, 'config/report.config.json'), JSON.stringify(noCloud))
    await expect(runRefresh({ root, env: {}, mcpRun: fakeMcp() })).rejects.toThrow(/cloud ID/)
  })
})

describe('refresh endpoint with the MCP route', () => {
  const call = async (handler, { method = 'POST', url = '/api/refresh', headers = { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' } } = {}) => {
    const req = Object.assign(new PassThrough(), { method, url, headers })
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b ? JSON.parse(b) : null } }
    await handler(req, res, () => {})
    return res
  }

  it('refreshes through the MCP and reports route, refetched count and cost', async () => {
    const root = mkRoot()
    const h = createRefreshHandler({ root, env: {}, mcpRun: fakeMcp() })
    const res = await call(h)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, route: 'mcp', tickets: 1, refetched: 1 })
    expect(res.body.costUsd).toBeGreaterThan(0)
  })

  it('shows progress on the status endpoint while a refresh runs, and nothing after', async () => {
    const root = mkRoot()
    let release
    const gate = new Promise((r) => { release = r })
    const slow = vi.fn(async (args) => { await gate; return fakeMcp()(args) })
    const h = createRefreshHandler({ root, env: {}, mcpRun: slow })
    const pending = call(h)
    await new Promise((r) => setTimeout(r, 10))
    const mid = await call(h, { method: 'GET', url: '/api/refresh/status' })
    expect(mid.body).toMatchObject({ ok: true, busy: true })
    expect(mid.body.progress).toMatchObject({ phase: 'tickets', costUsd: 0, maxUsd: 5 })
    expect(typeof mid.body.startedAt).toBe('number')
    release()
    await pending
    const after = await call(h, { method: 'GET', url: '/api/refresh/status' })
    expect(after.body).toEqual({ ok: true, busy: false, startedAt: null, progress: null })
  })

  it('applies the localhost guards to the status endpoint and allows GET only', async () => {
    const h = createRefreshHandler({ root: mkRoot(), env: {} })
    expect((await call(h, { method: 'GET', url: '/api/refresh/status', headers: { host: 'evil.example.com' } })).statusCode).toBe(403)
    expect((await call(h, { method: 'POST', url: '/api/refresh/status' })).statusCode).toBe(405)
  })
})

describe('runRefresh resume file', () => {
  const cacheFile = (root) => path.join(root, 'data-raw/mcp-history-cache.json')

  it('keeps fetched history in data-raw when a later batch fails, resumes from it, and cleans up after a good run', async () => {
    const root = mkRoot()
    const thirty = Array.from({ length: 30 }, (_, i) => row(`ABC-${i + 1}`))
    const answer = (failSecondBatch) => {
      let batches = 0
      const asked = []
      const run = vi.fn(async ({ prompt }) => {
        if (prompt.includes('"searchResultMode": "count"')) return '[30]'
        if (prompt.includes('listJiraIssueChangelogs')) {
          const keys = prompt.split('paging until all entries are read: ')[1].split('\n')[0].split(', ')
          asked.push(...keys)
          if (failSecondBatch && ++batches === 2) throw new Error('boom')
          return JSON.stringify(keys.map((k) => ({ k, h: HIST })))
        }
        return JSON.stringify(prompt.includes(`project IN (${cfg.projects[0]})`) ? thirty : [])
      })
      return { run, asked }
    }

    const first = answer(true)
    await expect(runRefresh({ root, env: {}, mcpRun: first.run })).rejects.toThrow()
    expect(Object.keys(JSON.parse(fs.readFileSync(cacheFile(root), 'utf8')))).toHaveLength(25) // the first batch was kept
    expect(fs.existsSync(path.join(root, 'public/data/report.json'))).toBe(false) // nothing half-written

    const second = answer(false)
    const out = await runRefresh({ root, env: {}, mcpRun: second.run })
    expect(second.asked).toHaveLength(5) // only the tickets the first try never reached
    expect(out).toMatchObject({ tickets: 30, refetched: 5 })
    expect(readReport(path.join(root, 'public/data/report.json')).tickets.every((t) => t.h.length === 1)).toBe(true)
    expect(fs.existsSync(cacheFile(root))).toBe(false)
  })

  it('uses REFRESH_MAX_USD as the total cap', async () => {
    const root = mkRoot()
    await expect(runRefresh({ root, env: { REFRESH_MAX_USD: '0.15' }, mcpRun: fakeMcp() })).rejects.toThrow(/spending limit of \$0\.15/)
  })
})
