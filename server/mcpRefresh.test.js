import { describe, it, expect, vi } from 'vitest'
import cfg from '../config/report.config.example.json'
import { refreshViaMcp } from './mcpRefresh.mjs'
import { JiraError } from './errors.mjs'

const CLOUD = cfg.cloudId
const NOW = new Date('2026-11-18T18:00:00.000Z')

const row = (k, over = {}) => ({
  k, t: `title ${k}`, s: 'In Progress', a: 'Doe, Jamie', pair: [],
  c: '2026-10-01T10:00:00.000-0400', u: '2026-11-10T09:00:00.000-0500', r: null,
  y: 'Story', z: null, d: null, sd: null, rk: `0|${k}:`, ...over,
})
const HIST = [['2026-10-05T10:00:00.000-0400', 'Open', 'In Progress']]

// A fake `run`: answers by looking at the prompt, and counts the calls of each kind.
function fakeRun({ byProject, count, history = (keys) => keys.map((k) => ({ k, h: HIST })) }) {
  const calls = { search: 0, count: 0, history: 0, historyKeys: [] }
  const run = vi.fn(async ({ prompt, onUsage }) => {
    onUsage?.({ costUsd: 0.25 })
    if (prompt.includes('"searchResultMode": "count"')) {
      calls.count++
      return JSON.stringify([count ?? Object.values(byProject).flat().length])
    }
    if (prompt.includes('listJiraIssueChangelogs')) {
      calls.history++
      const keys = prompt.split('paging until all entries are read: ')[1].split('\n')[0].split(', ')
      calls.historyKeys.push(keys)
      return JSON.stringify(history(keys))
    }
    calls.search++
    const project = Object.keys(byProject).find((p) => prompt.includes(`project IN (${p})`))
    return JSON.stringify(byProject[project])
  })
  return { run, calls }
}

const FIVE = { ABC: [row('ABC-1'), row('ABC-2'), row('ABC-3')], XYZ: [row('XYZ-1'), row('XYZ-2', { a: 'Poe, Sam' })] }

describe('refreshViaMcp, first full pull', () => {
  it('fetches rows per project, history in batches, and builds a version 4 report', async () => {
    const { run, calls } = fakeRun({ byProject: FIVE })
    const progress = vi.fn()
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW, batchSize: 2, concurrency: 1, onProgress: progress })
    expect(data.version).toBe(4)
    expect(data.tickets.map((t) => t.k).sort()).toEqual(['ABC-1', 'ABC-2', 'ABC-3', 'XYZ-1', 'XYZ-2'])
    expect(data.tickets.every((t) => t.h.length === 1)).toBe(true)
    expect(calls).toMatchObject({ search: 2, count: 1, history: 3 }) // 5 tickets, batches of 2
    expect(summary).toMatchObject({ tickets: 5, open: 5, closed: 0, route: 'mcp', refetched: 5, runs: 6, costUsd: 1.5 })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'history', done: 5, total: 5, maxUsd: 5 }))
    expect(progress.mock.calls.every(([p]) => typeof p.costUsd === 'number')).toBe(true) // every update carries the spend so far
  })
})

describe('refreshViaMcp, incremental', () => {
  const saved = (rows, hist = HIST) => ({ version: 4, tickets: rows.map((r) => ({ ...r, u: new Date(r.u).toISOString(), h: hist })) })

  it('fetches no history when nothing changed since the saved file, and keeps the saved history', async () => {
    const keep = [['2026-10-06T10:00:00.000Z', 'Open', 'Blocked']]
    const { run, calls } = fakeRun({ byProject: FIVE })
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved(Object.values(FIVE).flat(), keep), run, now: NOW })
    expect(calls.history).toBe(0)
    expect(summary.refetched).toBe(0)
    expect(data.tickets.every((t) => JSON.stringify(t.h) === JSON.stringify(keep))).toBe(true)
  })

  it('refetches only tickets whose updated time changed, and new ones', async () => {
    const changed = { ...FIVE, ABC: [row('ABC-1'), row('ABC-2', { u: '2026-11-17T09:00:00.000-0500' }), row('ABC-3'), row('ABC-9')] }
    const { run, calls } = fakeRun({ byProject: changed })
    const { summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved(Object.values(FIVE).flat()), run, now: NOW })
    expect(calls.historyKeys.flat().sort()).toEqual(['ABC-2', 'ABC-9'])
    expect(summary.refetched).toBe(2)
  })

  it('treats the same instant written in a different time zone as unchanged', async () => {
    const { run, calls } = fakeRun({ byProject: { ABC: [row('ABC-1', { u: '2026-11-10T14:00:00.000+0000' })], XYZ: [] } })
    await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved([row('ABC-1')]), run, now: NOW })
    expect(calls.history).toBe(0)
  })

  it('refetches everything when the saved file has no history for a ticket', async () => {
    const { run, calls } = fakeRun({ byProject: FIVE })
    const previous = { version: 4, tickets: Object.values(FIVE).flat().map((r) => ({ ...r, u: new Date(r.u).toISOString() })) }
    await refreshViaMcp({ cfg, cloudId: CLOUD, previous, run, now: NOW })
    expect(calls.historyKeys.flat()).toHaveLength(5)
  })
})

describe('refreshViaMcp, safety checks', () => {
  it('fails when Claude returns fewer tickets than Jira counts, so nothing is saved', async () => {
    const { run } = fakeRun({ byProject: FIVE, count: 40 })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW })).rejects.toThrow(/returned 5 tickets but Jira reports 40/)
  })
  it('allows a difference of a couple of tickets between the fetch and the count', async () => {
    const { run } = fakeRun({ byProject: FIVE, count: 6 })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW })).resolves.toBeTruthy()
  })
  it('fails when Claude skips a ticket in the history answer', async () => {
    const { run } = fakeRun({ byProject: FIVE, history: (keys) => keys.slice(1).map((k) => ({ k, h: HIST })) })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW })).rejects.toThrow(/skipped the history/)
  })
  it('fails on an empty answer and keeps the old file', async () => {
    const { run } = fakeRun({ byProject: { ABC: [], XYZ: [] } })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW })).rejects.toBeInstanceOf(JiraError)
  })
  it('rejects a row that carries an email address', async () => {
    const { run } = fakeRun({ byProject: { ABC: [row('ABC-1', { pair: ['x@example.com'] })], XYZ: [] } })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW })).rejects.toThrow(/email/)
  })
  it('stops starting new batches after one fails', async () => {
    const many = { ABC: Array.from({ length: 8 }, (_, i) => row(`ABC-${i + 1}`)), XYZ: [] }
    const { run, calls } = fakeRun({ byProject: many, history: () => { throw new Error('boom') } })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW, batchSize: 2, concurrency: 1 })).rejects.toThrow(/boom/)
    expect(calls.history).toBe(1) // 4 batches were planned, only the first ran
  })
  it('sums the reported cost of every run', async () => {
    const { run } = fakeRun({ byProject: { ABC: [row('ABC-1')], XYZ: [] } })
    const { summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW })
    expect(summary.runs).toBe(4) // two project searches, one count, one history batch
    expect(summary.costUsd).toBe(1)
  })
})

describe('refreshViaMcp, spending cap', () => {
  it('stops before starting a run once the total has reached the cap, and says so plainly', async () => {
    const { run, calls } = fakeRun({ byProject: FIVE })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW, maxTotalUsd: 0.5 })).rejects.toThrow(/spending limit of \$0\.50/)
    expect(calls.history).toBe(0) // each fake run costs 0.25: two searches reach the cap before the count or history runs
  })
  it('trims each run\'s own cap to what is left of the total', async () => {
    const { run } = fakeRun({ byProject: { ABC: [row('ABC-1')], XYZ: [] } })
    await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW, maxTotalUsd: 1.2 })
    const caps = run.mock.calls.map(([a]) => a.maxBudgetUsd)
    expect(caps[0]).toBe(1.2)
    expect(caps[caps.length - 1]).toBeCloseTo(0.45, 5) // 1.2 minus three runs at 0.25
    expect(Math.max(...caps)).toBeLessThanOrEqual(2)
  })
  it('keeps the default total at $5 and each run at $2 at most', async () => {
    const { run } = fakeRun({ byProject: { ABC: [row('ABC-1')], XYZ: [] } })
    await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW })
    expect(run.mock.calls[0][0].maxBudgetUsd).toBe(2)
  })
})

describe('refreshViaMcp, resuming after a failure', () => {
  const many = { ABC: Array.from({ length: 6 }, (_, i) => row(`ABC-${i + 1}`)), XYZ: [] }

  it('keeps the history it already fetched, and a second try only asks for the rest', async () => {
    const cache = {}
    let n = 0
    const flaky = fakeRun({ byProject: many, history: (keys) => { if (++n === 2) throw new Error('boom'); return keys.map((k) => ({ k, h: HIST })) } })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: flaky.run, now: NOW, batchSize: 2, concurrency: 1, cache })).rejects.toThrow(/boom/)
    expect(Object.keys(cache).sort()).toEqual(['ABC-1', 'ABC-2']) // the first batch survived

    const retry = fakeRun({ byProject: many })
    const { summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: retry.run, now: NOW, batchSize: 2, concurrency: 1, cache })
    expect(retry.calls.historyKeys.flat().sort()).toEqual(['ABC-3', 'ABC-4', 'ABC-5', 'ABC-6'])
    expect(summary.refetched).toBe(4)
  })
  it('calls onCheckpoint after every batch', async () => {
    const onCheckpoint = vi.fn()
    const { run } = fakeRun({ byProject: many })
    await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW, batchSize: 2, concurrency: 1, onCheckpoint })
    expect(onCheckpoint).toHaveBeenCalledTimes(3)
  })
  it('ignores a cached entry whose ticket has changed since', async () => {
    const cache = { 'ABC-1': { u: '2026-01-01T00:00:00.000Z', h: [['2026-01-01T00:00:00.000Z', 'Open', 'Blocked']] } }
    const { run, calls } = fakeRun({ byProject: { ABC: [row('ABC-1')], XYZ: [] } })
    const { data } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run, now: NOW, cache })
    expect(calls.historyKeys.flat()).toEqual(['ABC-1'])
    expect(data.tickets[0].h).toHaveLength(1)
    expect(data.tickets[0].h[0][2]).toBe('In Progress') // the fresh history, not the stale cached one
  })
})

describe('refreshViaMcp, paging by ticket key', () => {
  // A fake Jira that honours `key > "X"`, ORDER BY key and the page size in the prompt.
  const pagingRun = (all, { onSearch } = {}) => vi.fn(async ({ prompt, onUsage }) => {
    onUsage?.({ costUsd: 0.05 })
    if (prompt.includes('"searchResultMode": "count"')) return JSON.stringify([Object.values(all).flat().length])
    if (prompt.includes('listJiraIssueChangelogs')) {
      const keys = prompt.split('paging until all entries are read: ')[1].split('\n')[0].split(', ')
      return JSON.stringify(keys.map((k) => ({ k, h: HIST })))
    }
    const project = Object.keys(all).find((p) => prompt.includes(`project IN (${p})`))
    const after = /key > \\"[A-Z]+-(\d+)\\"/.exec(prompt)?.[1]
    const size = Number(/"maxResults": (\d+)/.exec(prompt)[1])
    onSearch?.({ project, after, size })
    return JSON.stringify(all[project].filter((r) => after === undefined || Number(r.k.split('-')[1]) > Number(after)).sort((a, b) => Number(a.k.split('-')[1]) - Number(b.k.split('-')[1])).slice(0, size))
  })
  const make = (project, n) => Array.from({ length: n }, (_, i) => row(`${project}-${i + 1}`))

  it('reads a project larger than one page in several runs and gets every ticket once', async () => {
    const all = { ABC: make('ABC', 95), XYZ: make('XYZ', 3) }
    const searches = []
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: pagingRun(all, { onSearch: (s) => searches.push(s) }), now: NOW })
    expect(data.tickets).toHaveLength(98)
    expect(new Set(data.tickets.map((t) => t.k)).size).toBe(98)
    expect(searches.filter((s) => s.project === 'ABC').map((s) => s.after)).toEqual([undefined, '40', '80']) // pages of 40: 40, 40, 15
    expect(searches.every((s) => s.size === 40)).toBe(true)
    expect(summary.refetched).toBe(98)
  })
  it('asks again after a page that is exactly full, and stops on an empty one', async () => {
    const all = { ABC: make('ABC', 40), XYZ: [] }
    const searches = []
    const { data } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: pagingRun(all, { onSearch: (s) => searches.push(s) }), now: NOW })
    expect(data.tickets).toHaveLength(40)
    expect(searches.filter((s) => s.project === 'ABC')).toHaveLength(2)
  })
  it('fails if paging does not move forward', async () => {
    const stuck = vi.fn(async ({ prompt, onUsage }) => { onUsage?.({ costUsd: 0.01 }); return prompt.includes('project IN (ABC)') ? JSON.stringify(make('ABC', 40)) : '[]' })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: stuck, now: NOW })).rejects.toThrow(/did not move forward/)
  })
  it('fails if a page contains a ticket from another project', async () => {
    const wrong = vi.fn(async ({ prompt, onUsage }) => { onUsage?.({ costUsd: 0.01 }); return prompt.includes('project IN (ABC)') ? JSON.stringify([row('OTHER-1')]) : '[]' })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: wrong, now: NOW })).rejects.toThrow(/outside ABC/)
  })
  it('catches a page that silently lost a ticket through the final count check', async () => {
    const all = { ABC: make('ABC', 100), XYZ: [] }
    const lossy = vi.fn(async (args) => {
      const out = await pagingRun(all)(args)
      return args.prompt.includes('project IN (ABC)') ? JSON.stringify(JSON.parse(out).slice(1)) : out // drops the first ticket of each page
    })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: lossy, now: NOW })).rejects.toThrow(/Jira reports 100/)
  })
})
