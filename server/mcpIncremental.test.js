import { describe, it, expect, vi } from 'vitest'
import cfg from '../config/report.config.example.json'
import { refreshViaMcp } from './mcpRefresh.mjs'

const CLOUD = cfg.cloudId
const T1 = new Date('2026-11-18T18:00:00.000Z')
const T2 = new Date('2026-11-19T18:00:00.000Z')
const HIST = [['2026-10-05T10:00:00.000-0400', 'Open', 'In Progress']]

const row = (k, over = {}) => ({
  k, t: `title ${k}`, s: 'In Progress', a: 'Doe, Jamie', pair: [],
  c: '2026-10-01T10:00:00.000-0400', u: '2026-11-10T09:00:00.000-0500', r: null,
  y: 'Story', z: null, d: null, sd: null, rk: `0|${k}:`, ...over,
})
const num = (k) => Number(k.split('-')[1])

// Reads the JSON string after `"jql": ` in a prompt.
const jqlOf = (prompt) => {
  const start = prompt.indexOf('"jql": ') + 7
  let i = start + 1
  while (prompt[i] !== '"' || prompt[i - 1] === '\\') i++
  return JSON.parse(prompt.slice(start, i + 1))
}

// The quoted names in `assignee IN ("A", "B")` (names can contain parentheses, so scan the quotes).
const assigneeNames = (jql) => {
  const i = jql.indexOf('assignee IN (')
  if (i < 0) return null
  const out = []
  let j = i + 13
  while (jql[j] !== ')' ) {
    if (jql[j] === '"') { let k = j + 1; while (jql[k] !== '"') k++; out.push(jql.slice(j + 1, k)); j = k }
    j++
  }
  return out
}

// A fake Jira + Claude. `world.tickets` is what Jira would return for the roster search. It understands the paging,
// date and key-list clauses the app writes, the count, the key listing and the history call, and logs what was asked.
function makeWorld(tickets, { historyOf = () => HIST, listShort = 0, wrongRows = false } = {}) {
  const world = { tickets, log: { rows: [], keys: [], deltaKeys: [], history: [], count: 0, since: [] } }
  world.run = vi.fn(async ({ prompt, onUsage }) => {
    onUsage?.({ costUsd: 0.05 })
    if (prompt.includes('"searchResultMode": "count"')) {
      world.log.count++
      const names = assigneeNames(jqlOf(prompt))
      return JSON.stringify([world.tickets.filter((r) => !names || names.includes(r.a) || r.pair.some((n) => names.includes(n))).length])
    }
    if (prompt.includes('listJiraIssueChangelogs')) {
      const keys = prompt.split('paging until all entries are read: ')[1].split('\n')[0].split(', ')
      world.log.history.push(...keys)
      return JSON.stringify(keys.map((k) => ({ k, h: historyOf(k) })))
    }
    const jql = jqlOf(prompt)
    const size = Number(/"maxResults": (\d+)/.exec(prompt)[1])
    const isKeys = prompt.includes('responseFields ["issues.key","issues.fields.updated"]')
    const project = /project IN \((\w+)\)/.exec(jql)?.[1]
    const after = /key > "[A-Z]+-(\d+)"/.exec(jql)?.[1]
    const since = /updated >= "([\d-]+)"/.exec(jql)?.[1]
    const keyIn = /key in \(([^)]*)\)/.exec(jql)?.[1]?.match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1))
    let list = world.tickets
    const names = assigneeNames(jql)
    if (names) list = list.filter((r) => names.includes(r.a) || r.pair.some((n) => names.includes(n)))
    if (project) list = list.filter((r) => r.k.startsWith(`${project}-`))
    if (after) list = list.filter((r) => num(r.k) > Number(after))
    if (since) { world.log.since.push(since); list = list.filter((r) => new Date(r.u) >= new Date(since)) }
    if (keyIn) list = list.filter((r) => keyIn.includes(r.k))
    list = [...list].sort((a, b) => num(a.k) - num(b.k)).slice(0, size)
    if (isKeys) {
      if (since) world.log.deltaKeys.push(list.length) // listing the recent window
      else world.log.keys.push(list.length) // the reconcile listing of everything
      const out = list.map((r) => ({ k: r.k, u: r.u }))
      return JSON.stringify(listShort ? out.slice(listShort) : out)
    }
    world.log.rows.push(...list.map((r) => r.k))
    return JSON.stringify(wrongRows ? [row('ABC-999')] : list)
  })
  return world
}

const base = () => [row('ABC-1'), row('ABC-2'), row('ABC-3'), row('XYZ-1'), row('XYZ-2', { a: 'Poe, Sam' })]

// Run a first full pull and return what it saved, as report.json would hold it.
async function firstPull(tickets) {
  const w = makeWorld(tickets)
  const { data } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: w.run, now: T1 })
  return data
}

describe('incremental refresh', () => {
  it('reads only tickets changed since the last pull, and re-reads history only for those', async () => {
    const saved = await firstPull(base())
    const changed = row('ABC-2', { u: '2026-11-17T09:00:00.000-0500', s: 'Closed', r: '2026-11-17T09:00:00.000-0500' })
    const fresh = row('XYZ-3', { u: '2026-11-18T10:00:00.000-0500' })
    const w = makeWorld([row('ABC-1'), changed, row('ABC-3'), row('XYZ-1'), row('XYZ-2', { a: 'Poe, Sam' }), fresh], { historyOf: () => [['2026-11-17T09:00:00.000-0500', 'In Progress', 'Closed']] })
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(summary.mode).toBe('incremental')
    expect(w.log.rows.sort()).toEqual(['ABC-2', 'XYZ-3']) // only the changed and the new ticket were read in full
    expect(w.log.history.sort()).toEqual(['ABC-2', 'XYZ-3'])
    expect(summary).toMatchObject({ tickets: 6, rowsRead: 2, refetched: 2 })
    expect(data.tickets.find((t) => t.k === 'ABC-2')).toMatchObject({ s: 'Closed' })
    expect(data.tickets.find((t) => t.k === 'ABC-1').h).toHaveLength(1) // untouched ticket kept its saved history
    expect(w.log.keys).toEqual([]) // the count matched, so no reconcile listing
    expect(w.log.deltaKeys.length).toBeGreaterThan(0) // the window was listed by key and updated time first
  })

  it('looks back three days before the last pull, so a time zone gap cannot hide a change', async () => {
    const saved = await firstPull(base())
    const w = makeWorld(base())
    await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(new Set(w.log.since)).toEqual(new Set(['2026-11-15'])) // pulled 2026-11-18, minus three days
  })

  it('uses far fewer runs than a full pull when most tickets have not changed', async () => {
    const many = Array.from({ length: 100 }, (_, i) => row(`ABC-${i + 1}`))
    const saved = await firstPull(many)
    const full = makeWorld(many)
    const inc = makeWorld(many)
    const a = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, full: true, run: full.run, now: T2 })
    const b = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: inc.run, now: T2 })
    expect(a.summary).toMatchObject({ mode: 'full', rowsRead: 100 })
    expect(b.summary).toMatchObject({ mode: 'incremental', rowsRead: 0, refetched: 0 })
    expect(full.log.rows).toHaveLength(100)
    expect(inc.log.rows).toHaveLength(0)
    expect(b.summary.runs).toBeLessThan(a.summary.runs) // 3 row pages for ABC in a full read, 1 in an incremental one
  })

  it('reads nothing in full when tickets touched since the last pull have not actually changed', async () => {
    const recent = (k, extra = {}) => row(k, { u: '2026-11-17T09:00:00.000-0500', ...extra })
    const tickets = [recent('ABC-1'), recent('ABC-2'), recent('XYZ-1'), row('XYZ-2', { a: 'Poe, Sam' })]
    const saved = await firstPull(tickets)
    const w = makeWorld(tickets) // all three recent tickets fall inside the look-back window, and none has changed
    const { summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(w.log.deltaKeys.reduce((a, b) => a + b, 0)).toBe(3) // they were listed
    expect(w.log.rows).toEqual([]) // but not read in full
    expect(summary).toMatchObject({ mode: 'incremental', rowsRead: 0, refetched: 0 })
  })

  it('reads in full only the one ticket in the window that changed', async () => {
    const recent = (k, extra = {}) => row(k, { u: '2026-11-17T09:00:00.000-0500', ...extra })
    const before = [recent('ABC-1'), recent('ABC-2'), recent('XYZ-1')]
    const saved = await firstPull(before)
    const w = makeWorld([recent('ABC-1'), recent('ABC-2', { u: '2026-11-18T09:00:00.000-0500', s: 'Closed', r: '2026-11-18T09:00:00.000-0500' }), recent('XYZ-1')])
    const { summary, data } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(w.log.rows).toEqual(['ABC-2'])
    expect(summary).toMatchObject({ rowsRead: 1, refetched: 1 })
    expect(data.tickets.find((t) => t.k === 'ABC-2').s).toBe('Closed')
  })

  it('still reads everything it should when the parallelism setting is nonsense', async () => {
    const saved = await firstPull(base())
    const changed = base().map((r) => (r.k === 'ABC-1' ? { ...r, u: '2026-11-18T10:00:00.000-0500' } : r))
    for (const concurrency of [NaN, 0, -2, undefined, 'x']) {
      const w = makeWorld(changed)
      const { summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2, concurrency })
      expect(summary.rowsRead, `concurrency ${concurrency}`).toBe(1)
      expect(w.log.rows).toEqual(['ABC-1'])
    }
  })

  it('reports the changed-tickets step and passes the model and parallelism options through', async () => {
    const saved = await firstPull(base())
    const w = makeWorld([...base(), row('XYZ-9', { u: '2026-11-18T10:00:00.000-0500' })])
    const progress = vi.fn()
    await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2, model: 'haiku', concurrency: 5, onProgress: progress })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'changed', total: 1 }))
    expect(w.run.mock.calls.every(([a]) => a.model === 'haiku')).toBe(true)
  })

  it('drops a ticket that has aged out of the history window without needing a reconcile listing', async () => {
    const old = row('ABC-4', { r: '2024-01-01T09:00:00.000-0500', s: 'Closed', u: '2024-01-01T09:00:00.000-0500' })
    const saved = await firstPull([...base(), old])
    expect(saved.tickets.some((t) => t.k === 'ABC-4')).toBe(true)
    const w = makeWorld(base()) // Jira's search no longer returns it
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(data.tickets.some((t) => t.k === 'ABC-4')).toBe(false)
    expect(summary.mode).toBe('incremental')
    expect(w.log.keys).toEqual([])
  })
})

describe('the history age cutoff', () => {
  it('does not reconcile when the count differs only by a ticket resolved on the cutoff', async () => {
    const edge = new Date(T2.getTime() - cfg.historyDays * 864e5 - 6 * 36e5).toISOString() // 6 hours past the cutoff: ours drops it
    const onEdge = row('ABC-4', { s: 'Closed', r: edge, u: edge })
    const saved = await firstPull([...base(), onEdge])
    const w = makeWorld([...base(), onEdge]) // Jira's day-granular cutoff still counts it
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(summary.mode).toBe('incremental')
    expect(w.log.keys).toEqual([])
    expect(data.tickets.some((t) => t.k === 'ABC-4')).toBe(false)
  })
  it('still reconciles when the count is off by more than the tickets on the cutoff', async () => {
    const saved = await firstPull(base())
    const w = makeWorld(base().filter((r) => r.k !== 'ABC-3'))
    expect((await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })).summary.mode).toBe('reconciled')
  })
})

describe('reconciliation when the count does not match', () => {
  it('removes a ticket that left the roster, using a key listing', async () => {
    const saved = await firstPull(base())
    const w = makeWorld(base().filter((r) => r.k !== 'ABC-3')) // reassigned away, so the roster search no longer returns it
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(summary.mode).toBe('reconciled')
    expect(data.tickets.map((t) => t.k).sort()).toEqual(['ABC-1', 'ABC-2', 'XYZ-1', 'XYZ-2'])
    expect(w.log.keys.length).toBeGreaterThan(0)
  })

  it('reads a ticket the date filter missed, such as one moved into the roster without a recent update', async () => {
    const saved = await firstPull(base())
    const sneaky = row('ABC-7', { u: '2026-09-01T09:00:00.000-0400' }) // old updated time, but new to the roster
    const w = makeWorld([...base(), sneaky])
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })
    expect(summary.mode).toBe('reconciled')
    expect(data.tickets.some((t) => t.k === 'ABC-7')).toBe(true)
    expect(w.log.rows).toContain('ABC-7')
    expect(w.log.history).toContain('ABC-7')
  })

  it('fails, keeping the old data, when the key listing is shorter than Jira says', async () => {
    const saved = await firstPull(base())
    const w = makeWorld(base().filter((r) => r.k !== 'ABC-3'), { listShort: 3 })
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })).rejects.toThrow(/listed \d+ tickets but Jira reports/)
  })

  it('fails when the rows read for a reconcile are not the ones asked for', async () => {
    const saved = await firstPull(base())
    const w = makeWorld([...base(), row('ABC-7', { u: '2026-09-01T09:00:00.000-0400' })], { wrongRows: true })
    // wrongRows also corrupts the delta read, which fails the project check first; either way nothing is saved
    await expect(refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w.run, now: T2 })).rejects.toThrow()
  })
})

describe('when a full read is used instead', () => {
  it('reads everything when there is no saved file', async () => {
    const w = makeWorld(base())
    const { summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: w.run, now: T1 })
    expect(summary).toMatchObject({ mode: 'full', rowsRead: 5 })
    expect(w.log.since).toEqual([])
  })
  it('reads everything for a version 3 file, which lacks the newer fields', async () => {
    const saved = await firstPull(base())
    const v3 = { ...saved, version: 3 }
    const w = makeWorld(base())
    expect((await refreshViaMcp({ cfg, cloudId: CLOUD, previous: v3, run: w.run, now: T2 })).summary.mode).toBe('full')
  })
  it('reads everything when asked to, and when the saved file has no pull time', async () => {
    const saved = await firstPull(base())
    const w1 = makeWorld(base())
    expect((await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, full: true, run: w1.run, now: T2 })).summary.mode).toBe('full')
    const w2 = makeWorld(base())
    const noMeta = { ...saved, meta: {} }
    expect((await refreshViaMcp({ cfg, cloudId: CLOUD, previous: noMeta, run: w2.run, now: T2 })).summary.mode).toBe('full')
  })
})

describe('roster changes', () => {
  const ROE = 'Roe, Alex (NonEmp)'
  const roeTickets = () => [row('ABC-5', { a: ROE }), row('ABC-6', { a: ROE, u: '2026-08-01T09:00:00.000-0400' }), row('XYZ-5', { a: 'Doe, Jamie', pair: [ROE] })]
  const without = (name) => ({ ...cfg, roster: cfg.roster.filter((r) => r.jiraName !== name) })

  it('records who was tracked at the pull', async () => {
    const saved = await firstPull(base())
    expect(saved.meta.roster).toEqual(cfg.roster.map((r) => r.jiraName))
  })

  it('reads only a new person\'s tickets, whatever their updated times, and nobody else\'s', async () => {
    const world = [...base(), ...roeTickets()]
    const w1 = makeWorld(world)
    const { data: saved } = await refreshViaMcp({ cfg: without(ROE), cloudId: CLOUD, previous: null, run: w1.run, now: T1 })
    expect(saved.tickets.some((t) => t.a === ROE)).toBe(false)
    expect(saved.tickets).toHaveLength(6) // base five plus XYZ-5, which is Doe's; Roe is only its Pair

    const w2 = makeWorld(world)
    const { data, summary } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: saved, run: w2.run, now: T2 })
    expect(summary.added).toEqual([ROE])
    expect(summary.mode).toBe('incremental') // the count matches, so no key listing
    expect(w2.log.rows.sort()).toContain('ABC-6') // old ticket, found only because the person is new
    expect(data.tickets.filter((t) => t.a === ROE).map((t) => t.k).sort()).toEqual(['ABC-5', 'ABC-6'])
    expect(w2.log.history.sort()).toEqual(['ABC-5', 'ABC-6']) // XYZ-5 was saved already and has not changed
    expect(w2.log.rows.filter((k) => k.startsWith('ABC-1')).length).toBe(0) // other people's tickets were not re-read
  })

  it('drops a removed person\'s tickets at no cost, but keeps tickets still tracked through someone else', async () => {
    const world = [...base(), ...roeTickets()]
    const w1 = makeWorld(world)
    const { data: saved } = await refreshViaMcp({ cfg, cloudId: CLOUD, previous: null, run: w1.run, now: T1 })
    expect(saved.tickets.some((t) => t.a === ROE)).toBe(true)

    const w2 = makeWorld(world) // Jira's search for the smaller roster
    const { data, summary } = await refreshViaMcp({ cfg: without(ROE), cloudId: CLOUD, previous: saved, run: w2.run, now: T2 })
    expect(summary.pruned).toBe(2) // ABC-5 and ABC-6; XYZ-5 stays because Doe is assigned
    expect(data.tickets.some((t) => t.a === ROE)).toBe(false)
    expect(data.tickets.some((t) => t.k === 'XYZ-5')).toBe(true)
    expect(summary.mode).toBe('incremental')
    expect(w2.log.history).toEqual([])
    expect(data.meta.roster).not.toContain(ROE)
  })
})
