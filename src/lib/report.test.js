import { describe, it, expect, afterEach } from 'vitest'
import cfgExample from '../../config/report.config.example.json'
import { buildReport, bucketOf, shortName, autoNote, pulledLabel } from './report.js'
import { resolveWindow, buildPresets, parseIsoDay, windowLabel, loadRange, defaultRange } from './windows.js'
import { fiscalPosition } from './fiscal.js'

// Everything here is synthetic. No real names, tickets or Jira data are used, so the tests run on a fresh clone.
// A ticket counts in a window when it was created, resolved, or changed status in it. Comment-only edits (u) do not count.
const config = cfgExample
const meta = { pulledAt: '2026-11-04T17:00:00.000Z', historyDays: 366, historyStart: '2026-07-07T17:00:00.000Z', source: 'example.atlassian.net' }
const PULL = new Date(meta.pulledAt)
const HISTORY_START = new Date(meta.historyStart)
const day = (n) => new Date(PULL.getTime() - n * 864e5).toISOString()
const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).toISOString()
const T = (k, s, a, pair, over = {}) => ({ k, t: `title ${k}`, s, a, pair, c: day(90), u: day(90), r: null, h: [], ...over })
const win = (range, today = PULL) => resolveWindow(range, PULL, HISTORY_START, today)

const [R0, R1, R2] = config.roster.map((r) => r.jiraName)
const sample = [
  T('EX-1', 'Closed', R0, [], { r: day(1), h: [[day(1), 'In Progress', 'Closed']] }),
  T('EX-2', 'Closed', R0, [], { r: day(10), h: [[day(10), 'In Progress', 'Closed']] }),
  T('EX-3', 'In Progress', R0, [], { h: [[day(2), 'Open', 'In Progress']] }),
  T('EX-4', 'Blocked', R1, [], { h: [[day(40), 'Open', 'Blocked']] }),
  T('EX-5', 'PM Review', R1, [R2], { h: [[day(3), 'In Progress', 'PM Review']] }),
  T('EX-6', 'Open', R2, []),
  T('EX-7', 'Blocked', R2, [], { h: [[day(1), 'Open', 'Blocked']] }),
  T('EX-8', 'Closed', R1, [], { r: day(20), h: [[day(20), 'In Progress', 'Closed']] }),
  T('EX-9', 'Open', 'Dev, Dee', [R0]),
]
const data = { version: 3, meta, tickets: sample }
const tile = (r, id) => r.kpis.find((k) => k.id === id).value

describe('a sample report across every range', () => {
  const IDS = ['last7', 'last14', 'last30', 'period', 'quarter']

  it('covers every roster member in every range, active or not', () => {
    for (const id of IDS) {
      const r = buildReport(data, win({ id }), config)
      expect(r.rows).toHaveLength(config.roster.length)
      expect(r.active.length + r.quiet.length).toBe(config.roster.length)
    }
  })

  it('counts tickets closed in each range by their resolved date', () => {
    const closed = (id) => tile(buildReport(data, win({ id }), config), 'closed')
    expect(closed('last7')).toBe(1)
    expect(closed('last14')).toBe(2)
    expect(closed('last30')).toBe(3)
    expect(closed('period')).toBe(3)
    expect(closed('quarter')).toBe(3)
  })

  it('shows every ticket blocked at the end of a range that ends now', () => {
    for (const id of ['last7', 'last30', 'quarter']) {
      expect(buildReport(data, win({ id }), config).blocked.map((b) => b.issue.k).sort()).toEqual(['EX-4', 'EX-7'])
    }
  })

  it('marks a blocked ticket with no status change in the range', () => {
    const r = buildReport(data, win({ id: 'last7' }), config)
    expect(r.blocked.map((b) => [b.issue.k, b.movedThisWeek])).toEqual([['EX-4', false], ['EX-7', true]])
  })

  it('counts a shared ticket once in the tiles and shows it on both designers', () => {
    const r = buildReport(data, win({ id: 'last7' }), config)
    expect(tile(r, 'review')).toBe(1)
    expect(r.rows.find((d) => d.name === R1).own.map((i) => i.k)).toContain('EX-5')
    expect(r.rows.find((d) => d.name === R2).pair.map((i) => i.k)).toContain('EX-5')
  })
})

// Fixed fixtures for the individual rules.
const cfg = { ...config, roster: [{ jiraName: 'A, Ann' }, { jiraName: 'B, Bo' }] }
const rep = (tickets, id = 'last7') => buildReport({ version: 3, meta, tickets }, win({ id }), cfg)

describe('buildReport rules', () => {
  it('counts created, resolved and status-changed tickets, but not comment-only edits or quiet tickets', () => {
    const r = rep([
      T('X-1', 'Closed', 'A, Ann', [], { c: at(10, 1), r: at(11, 3), h: [[at(11, 3), 'In Progress', 'Closed']] }), // resolved in range
      T('X-2', 'Closed', 'A, Ann', [], { c: at(9, 1), r: at(10, 1), u: at(11, 3), h: [[at(10, 1), 'In Progress', 'Closed']] }), // closed long ago, commented since
      T('X-3', 'In Progress', 'A, Ann', [], { c: at(9, 1), h: [[at(11, 2), 'Open', 'In Progress']] }), // status change in range
      T('X-4', 'Open', 'A, Ann', [], { c: at(9, 1), u: at(11, 3) }), // open, only commented: not counted
      T('X-5', 'Open', 'A, Ann', [], { c: at(11, 2) }), // created in range
    ])
    const ann = r.rows.find((d) => d.name === 'A, Ann')
    expect(ann.own.map((i) => i.k).sort()).toEqual(['X-1', 'X-3', 'X-5'])
    expect(ann.idle.map((i) => i.k)).toEqual(['X-4'])
    expect(tile(r, 'closed')).toBe(1)
  })

  it('treats the end of a range as exclusive and the start as inclusive', () => {
    const w = win({ id: 'custom', since: '2026-10-20', until: '2026-10-21' }) // Oct 20 00:00 up to, not including, Oct 22 00:00
    const r = buildReport({ version: 3, meta, tickets: [
      T('X-1', 'Open', 'A, Ann', [], { c: new Date(2026, 9, 20, 0, 0).toISOString() }), // exactly the start: in
      T('X-2', 'Open', 'A, Ann', [], { c: new Date(2026, 9, 21, 23, 59).toISOString() }), // last minute: in
      T('X-3', 'Open', 'A, Ann', [], { c: new Date(2026, 9, 22, 0, 0).toISOString() }), // exactly the end: out
    ] }, w, cfg)
    expect(r.rows.find((d) => d.name === 'A, Ann').own.map((i) => i.k)).toEqual(['X-1', 'X-2'])
  })

  it('moves a ticket out of the range when its last status change is older than the range', () => {
    const tickets = [T('X-1', 'In Progress', 'A, Ann', [], { c: at(9, 1), h: [[at(10, 20), 'Open', 'In Progress']] })]
    expect(rep(tickets, 'last7').active).toHaveLength(0)
    expect(rep(tickets, 'last30').active).toHaveLength(1)
  })

  it('credits a paired designer and records the assignee', () => {
    const r = rep([T('X-3', 'In Progress', 'Dev, Dee', ['B, Bo'], { h: [[at(11, 3), 'Open', 'In Progress']] })])
    const bo = r.rows.find((d) => d.name === 'B, Bo')
    expect(bo.own).toHaveLength(0)
    expect(bo.pair[0]).toMatchObject({ k: 'X-3', a: 'Dev, Dee' })
  })

  it('shows a roster member with no tickets at all in the no-activity table', () => {
    const r = rep([T('X-1', 'Open', 'A, Ann', [], { c: at(11, 3) })])
    expect(r.quiet.map((d) => d.name)).toEqual(['B, Bo'])
    expect(r.quiet[0].note).toMatch(/No open assigned or paired tickets/)
  })

  it('says how many open tickets a quiet designer still has', () => {
    const r = rep([T('X-1', 'Open', 'B, Bo', [], { c: at(8, 1) })])
    expect(r.quiet.find((d) => d.name === 'B, Bo').note).toBe('1 assigned ticket and 0 paired tickets open. No activity in the last 7 days.')
  })

  it('ignores tickets that involve nobody on the roster', () => {
    const r = rep([T('X-2', 'Blocked', 'Z, Zed', [], { h: [[at(11, 3), 'Open', 'Blocked']] })])
    expect(r.blocked).toHaveLength(0)
    expect(r.active).toHaveLength(0)
  })

  it('lists blocked tickets with days blocked, and marks the ones with no status change in the range', () => {
    const r = rep([
      T('X-1', 'Blocked', 'A, Ann', [], { h: [[at(11, 3), 'Open', 'Blocked']] }),
      T('X-2', 'Blocked', 'A, Ann', [], { h: [[at(8, 1), 'Open', 'Blocked']] }),
    ])
    expect(r.blocked.map((b) => [b.issue.k, b.movedThisWeek])).toEqual([['X-1', true], ['X-2', false]])
    expect(r.blocked[0].days).toBe(1)
  })

  it('treats an unknown Jira status as the default bucket', () => {
    expect(bucketOf({ s: 'Some New Status' }, config)).toBe('open')
    expect(bucketOf({ s: 'Ready for Test' }, config)).toBe('review')
  })
})

describe('a window that ended in the past is judged as it was then', () => {
  // Window: Oct 5 to Oct 11 inclusive, so it ends before the pull.
  const past = (tickets) => buildReport({ version: 3, meta, tickets }, win({ id: 'custom', since: '2026-10-05', until: '2026-10-11' }), cfg)

  it('shows the status at the end of the window, not the current one, and does not count a later close', () => {
    const r = past([T('X-1', 'Closed', 'A, Ann', [], { c: at(9, 1), r: at(10, 20), h: [[at(10, 8), 'Open', 'In Progress'], [at(10, 20), 'In Progress', 'Closed']] })])
    expect(tile(r, 'closed')).toBe(0)
    expect(tile(r, 'prog')).toBe(1)
    expect(r.rows.find((d) => d.name === 'A, Ann').own[0].s).toBe('In Progress')
  })

  it('lists a ticket blocked at the end of the window even if it was unblocked later, with its days at that time', () => {
    const r = past([T('X-1', 'In Progress', 'A, Ann', [], { c: at(9, 1), h: [[at(10, 8), 'Open', 'Blocked'], [at(10, 20), 'Blocked', 'In Progress']] })])
    expect(r.blocked.map((b) => [b.issue.k, b.days])).toEqual([['X-1', 3]])
  })

  it('does not list a ticket that was unblocked before the window ended', () => {
    const r = past([T('X-1', 'In Progress', 'A, Ann', [], { c: at(9, 1), h: [[at(10, 8), 'Open', 'Blocked'], [at(10, 9), 'Blocked', 'In Progress']] })])
    expect(r.blocked).toHaveLength(0)
  })

  it('leaves out a ticket created after the window, and a ticket resolved before it', () => {
    const r = past([
      T('X-1', 'Open', 'A, Ann', [], { c: at(10, 15) }),
      T('X-2', 'Closed', 'A, Ann', [], { c: at(9, 1), r: at(9, 20), h: [[at(9, 20), 'In Progress', 'Closed']] }),
    ])
    expect(r.active).toHaveLength(0)
    expect(r.rows.find((d) => d.name === 'A, Ann').idle).toHaveLength(0)
  })

  it('writes the range into the notes', () => {
    const r = past([T('X-1', 'Open', 'A, Ann', [], { c: at(10, 6) })])
    expect(r.rows.find((d) => d.name === 'A, Ann').note).toMatch(/Activity from Oct 5 to Oct 11/)
  })
})

describe('comparing two ranges', () => {
  const tickets = [
    T('X-1', 'Closed', 'A, Ann', [], { r: at(11, 3), h: [[at(11, 3), 'In Progress', 'Closed']] }),
    T('X-2', 'Closed', 'A, Ann', [], { r: at(11, 2), h: [[at(11, 2), 'In Progress', 'Closed']] }),
    T('X-3', 'Closed', 'B, Bo', [], { r: at(10, 25), h: [[at(10, 25), 'In Progress', 'Closed']] }),
  ]
  const run = (range) => buildReport({ version: 3, meta, tickets }, win(range), cfg)

  it('adds the earlier value and the change to each tile, from the range of the same length just before', () => {
    const r = run({ id: 'last7', compare: 'previous' })
    const closed = r.kpis.find((k) => k.id === 'closed')
    expect([closed.value, closed.prev, closed.change, closed.good]).toEqual([2, 1, 1, 'up'])
    expect(r.compare.ok).toBe(true)
  })

  it('adds nothing when compare is off', () => {
    expect(run({ id: 'last7' }).kpis.every((k) => k.change === undefined)).toBe(true)
  })

  it('compares a last-period preset with the fiscal period before it', () => {
    const early = new Date(2026, 0, 1)
    const w = resolveWindow({ id: 'lastperiod', compare: 'previous' }, PULL, early, new Date(2026, 9, 28))
    expect(w.label).toBe('Last period (P9)')
    expect(w.compare.ok).toBe(true)
    expect([w.compare.start.getMonth(), w.compare.start.getDate()]).toEqual([7, 16]) // P8 starts Aug 16
  })

  it('is unavailable, with a reason, when the earlier range reaches before the saved data', () => {
    const w = resolveWindow({ id: 'last30', compare: 'previous' }, PULL, new Date(PULL.getTime() - 40 * 864e5))
    expect(w.compare.ok).toBe(false)
    expect(w.compare.reason).toMatch(/saved data only goes back/)
  })
})

describe('comparing with a range chosen from the Date range menu', () => {
  const TODAY = new Date(2026, 9, 28, 13, 0) // Wed Oct 28 2026: P10 (Oct 11 to Nov 7), Q3
  const pull = new Date(2026, 9, 28, 13, 0)
  const early = new Date(2026, 0, 1)
  const res = (range) => resolveWindow(range, pull, early, TODAY)

  it('offers every Date range preset as a comparison, in the same order', () => {
    const w = res({ id: 'period', compare: 'off' })
    expect(w.compareChoices.map((c) => c.id)).toEqual(w.presets.map((p) => p.id))
  })

  it('compares This period with Last period, whole fiscal periods, and says the lengths differ', () => {
    const w = res({ id: 'period', compare: 'lastperiod' })
    expect(w.compare.ok).toBe(true)
    expect(w.compare.label).toBe('Sep 13 to Oct 10, 2026')
    expect([w.days, w.compare.days]).toEqual([18, 28]) // P10 so far (Oct 11 to Oct 28 noon) against all of P9
    expect(w.compare.sameLength).toBe(false)
  })

  it('reports equal lengths as the same length', () => {
    const w = res({ id: 'custom', since: '2026-10-05', until: '2026-10-11', compare: 'previous' })
    expect([w.days, w.compare.days, w.compare.sameLength]).toEqual([7, 7, true])
  })

  it('treats a daylight-saving week as the same length as an ordinary week', () => {
    // Nov 1 2026 is the fall clock change: the week of Nov 1 has 169 hours, the week of Oct 25 has 168.
    const w = resolveWindow({ id: 'custom', since: '2026-11-01', until: '2026-11-07', compare: 'previous' }, new Date(2026, 10, 9, 12), early, new Date(2026, 10, 9, 12))
    expect(w.compare.sameLength).toBe(true)
  })

  it('still offers the automatic previous range, unchanged', () => {
    const w = res({ id: 'last7', compare: 'previous' })
    expect(w.compare.ok).toBe(true)
    expect(w.compare.sameLength).toBe(true)
    expect(w.compareOption.ok).toBe(true)
  })

  it('greys out the range being viewed, and any range that overlaps it, with a reason', () => {
    const w = res({ id: 'period' })
    const by = (id) => w.compareChoices.find((c) => c.id === id)
    expect(by('period')).toMatchObject({ ok: false, reason: 'This is the range you are viewing.' })
    expect(by('quarter')).toMatchObject({ ok: false, reason: 'Overlaps the date range you are viewing.' }) // Q3 contains P10
    expect(by('last30').ok).toBe(false) // the last 30 days overlap P10
    expect(by('lastperiod').ok).toBe(true)
  })

  it('does not overlap when ranges only touch', () => {
    const w = res({ id: 'lastperiod' }) // Sep 13 to Oct 10
    expect(w.compareChoices.find((c) => c.id === 'period').ok).toBe(true) // P10 starts Oct 11, the day after
  })

  it('greys out a comparison that reaches before the saved data, or after the last refresh', () => {
    const tight = resolveWindow({ id: 'period' }, pull, new Date(2026, 8, 1), TODAY) // data starts Sep 1
    const q = tight.compareChoices.find((c) => c.id === 'lastquarter')
    expect(q.ok).toBe(false)
    expect(q.reason).toMatch(/saved data only goes back/)
    const stale = resolveWindow({ id: 'last7' }, pull, early, new Date(2026, 10, 9, 9)) // today is Nov 9, data is from Oct 28
    const p = stale.compareChoices.find((c) => c.id === 'period')
    expect(p.ok).toBe(false)
    expect(p.reason).toMatch(/Refresh from Jira/)
  })

  it('falls back to no comparison when a saved comparison is no longer usable', () => {
    expect(res({ id: 'period', compare: 'period' }).compare?.ok).toBeFalsy() // cannot compare with itself
    expect(res({ id: 'period', compare: 'quarter' }).compare?.ok).toBeFalsy() // overlaps
    expect(res({ id: 'period', compare: 'nonsense' }).compare).toBeNull()
    expect(res({ id: 'period', compare: 'off' }).compare).toBeNull()
  })

  it('adds the earlier value and change to the tiles using the chosen preset', () => {
    const tickets = [
      T('X-1', 'Closed', 'A, Ann', [], { c: at(9, 1), r: at(10, 21), h: [[at(10, 21), 'In Progress', 'Closed']] }), // in P10
      T('X-2', 'Closed', 'A, Ann', [], { c: at(8, 1), r: at(9, 20), h: [[at(9, 20), 'In Progress', 'Closed']] }), // in P9
      T('X-3', 'Closed', 'B, Bo', [], { c: at(8, 1), r: at(9, 25), h: [[at(9, 25), 'In Progress', 'Closed']] }), // in P9
    ]
    const r = buildReport({ version: 3, meta, tickets }, res({ id: 'period', compare: 'lastperiod' }), cfg)
    const closed = r.kpis.find((k) => k.id === 'closed')
    expect([closed.value, closed.prev, closed.change]).toEqual([1, 2, -1])
  })

  describe('the saved choice', () => {
    afterEach(() => { delete globalThis.localStorage })
    const store = (v) => { globalThis.localStorage = { getItem: () => v, setItem() {} } }
    it('keeps a preset id as the comparison, and ignores junk', () => {
      store(JSON.stringify({ id: 'period', compare: 'lastperiod' }))
      expect(loadRange().compare).toBe('lastperiod')
      store(JSON.stringify({ id: 'period', compare: 'previous' }))
      expect(loadRange().compare).toBe('previous')
      store(JSON.stringify({ id: 'period', compare: '<script>' }))
      expect(loadRange().compare).toBe('off')
      store(JSON.stringify({ id: 'period', compare: 7 }))
      expect(loadRange().compare).toBe('off')
    })
  })
})

describe('notes and formatting', () => {
  it('writes a factual line from statuses only, naming the range', () => {
    const items = [{ k: 'X-1', s: 'Closed' }, { k: 'X-2', s: 'Closed' }, { k: 'X-3', s: 'PM Review' }, { k: 'X-4', s: 'Blocked' }]
    expect(autoNote(items, 'in the last 14 days', config)).toBe('Activity in the last 14 days: 2 closed, 1 in PM review. Blocked: X-4.')
  })

  it('formats names and times for display', () => {
    expect(shortName('Doe, Jamie A')).toBe('Jamie Doe')
    expect(shortName('Roe, Alex (NonEmp)')).toBe('Alex Roe')
    expect(pulledLabel({ pulledAt: '2026-10-28T16:30:05.000Z' })).toMatch(/2026.*\d{1,2}:\d{2}:05/)
  })
})

describe('fiscal calendar (FY2026 checked against the printed Kroger calendar)', () => {
  const at = (y, m, d) => fiscalPosition(new Date(y, m - 1, d))
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  it('matches all 13 period start and end dates', () => {
    const printed = [
      ['2026-02-01', '2026-02-28'], ['2026-03-01', '2026-03-28'], ['2026-03-29', '2026-04-25'], ['2026-04-26', '2026-05-23'],
      ['2026-05-24', '2026-06-20'], ['2026-06-21', '2026-07-18'], ['2026-07-19', '2026-08-15'], ['2026-08-16', '2026-09-12'],
      ['2026-09-13', '2026-10-10'], ['2026-10-11', '2026-11-07'], ['2026-11-08', '2026-12-05'], ['2026-12-06', '2027-01-02'], ['2027-01-03', '2027-01-30'],
    ]
    printed.forEach(([start, end], i) => {
      const [y, m, d] = start.split('-').map(Number)
      const p = at(y, m, d)
      expect([p.period, iso(p.periodStart), iso(p.periodEnd)]).toEqual([i + 1, start, end])
    })
  })

  it('puts the quarters where the printed calendar does (16, 12, 12, 12 weeks)', () => {
    const q = (m, d, y = 2026) => { const p = at(y, m, d); return [p.quarter, iso(p.quarterStart), iso(p.quarterEnd)] }
    expect(q(2, 1)).toEqual([1, '2026-02-01', '2026-05-23'])
    expect(q(5, 24)).toEqual([2, '2026-05-24', '2026-08-15'])
    expect(q(10, 28)).toEqual([3, '2026-08-16', '2026-11-07'])
    expect(q(12, 25)).toEqual([4, '2026-11-08', '2027-01-30'])
  })

  it('is correct on the boundaries, and the first day of the next year starts FY2027', () => {
    expect(at(2026, 11, 7).period).toBe(10)
    expect(at(2026, 11, 8).period).toBe(11)
    const next = at(2027, 1, 31)
    expect([next.year, next.period, next.quarter]).toEqual([2027, 1, 1])
  })

  it('gives the year start and end, and the previous period and quarter across the year edge', () => {
    const p = at(2026, 10, 28)
    expect([iso(p.yearStart), iso(p.yearEnd)]).toEqual(['2026-02-01', '2027-01-30'])
    const before = at(2027, 1, 31) // first day of FY2027 (assumed calendar)
    const prevPeriod = fiscalPosition(new Date(before.periodStart.getFullYear(), before.periodStart.getMonth(), before.periodStart.getDate() - 1))
    expect([prevPeriod.year, prevPeriod.period, iso(prevPeriod.periodStart)]).toEqual([2026, 13, '2027-01-03'])
    const prevQuarter = fiscalPosition(new Date(before.quarterStart.getFullYear(), before.quarterStart.getMonth(), before.quarterStart.getDate() - 1))
    expect([prevQuarter.year, prevQuarter.quarter]).toEqual([2026, 4])
  })

  it('returns null outside the known years instead of guessing', () => {
    expect(at(2026, 1, 31)).toBeNull()
    expect(at(2028, 6, 1)).toBeNull()
  })
})

describe('date ranges', () => {
  const TODAY = new Date(2026, 9, 28, 13, 0) // Wed Oct 28 2026, fiscal P10 and Q3

  it('offers rolling, calendar and fiscal presets, with dates', () => {
    const presets = buildPresets(TODAY, new Date(2026, 5, 30))
    expect(presets.map((p) => p.label)).toEqual([
      'Last 7 days', 'Last 14 days', 'Last 30 days', 'This week', 'Last full week',
      'This period (P10)', 'Last period (P9)', 'This quarter (Q3)', 'Last quarter (Q2)', 'Fiscal year to date (FY2026)',
    ])
    // Q2 and the fiscal year start before the saved data, which begins Jun 30
    expect(presets.filter((p) => p.disabled).map((p) => p.id)).toEqual(['lastquarter', 'fytd'])
  })

  it('works out the week, period and quarter from today, not from the last pull', () => {
    // The data was pulled on Oct 28 (P10, Q3). Today is Nov 9, which is P11 and Q4.
    const pull = new Date(2026, 9, 28, 13, 0)
    const today = new Date(2026, 10, 9, 9, 0)
    const labels = buildPresets(pull, new Date(2026, 5, 30), today).map((p) => p.label)
    expect(labels).toContain('This period (P11)')
    expect(labels).toContain('This quarter (Q4)')
    expect(labels).toContain('Last period (P10)')
    expect(labels).toContain('Last quarter (Q3)')
  })

  it('disables a range that starts after the last refresh, and says to refresh', () => {
    const pull = new Date(2026, 9, 28, 13, 0)
    const today = new Date(2026, 10, 9, 9, 0)
    const p = buildPresets(pull, new Date(2026, 5, 30), today)
    expect(p.find((x) => x.id === 'period').disabled).toBe(true)
    expect(p.find((x) => x.id === 'period').reason).toMatch(/Refresh from Jira/)
    expect(resolveWindow({ id: 'period' }, pull, new Date(2026, 5, 30), today).stale).toBe(true)
  })

  it('holds the end of a calendar range back to the last refresh', () => {
    const w = resolveWindow({ id: 'period' }, PULL, HISTORY_START, PULL) // P10 runs to Nov 7, the pull is Nov 4
    expect(w.end.getTime()).toBe(PULL.getTime())
    const lastPeriod = resolveWindow({ id: 'lastperiod' }, PULL, HISTORY_START, PULL) // P9 ended Oct 10
    expect([lastPeriod.end.getMonth(), lastPeriod.end.getDate()]).toEqual([9, 11])
    expect(windowLabel(lastPeriod)).toBe('Sep 13 to Oct 10, 2026')
  })

  it('starts weeks on Sunday at midnight, and "last full week" is the Sunday to Saturday before this one', () => {
    const p = buildPresets(PULL, HISTORY_START, new Date(2026, 10, 4, 15)) // Wed Nov 4
    const week = p.find((x) => x.id === 'week')
    const last = p.find((x) => x.id === 'lastweek')
    expect([week.start.getDay(), week.start.getHours(), week.start.getDate()]).toEqual([0, 0, 1]) // Sun Nov 1
    expect([last.start.getDate(), last.end.getDate()]).toEqual([25, 1]) // Oct 25 up to Nov 1
  })

  it('hides the fiscal presets when the date is outside the known calendar', () => {
    expect(buildPresets(new Date(2029, 5, 1), new Date(2029, 0, 1)).map((p) => p.id)).toEqual(['last7', 'last14', 'last30', 'week', 'lastweek'])
  })

  it('falls back to the first preset for an unknown or unavailable choice', () => {
    expect(win({ id: 'nonsense' }).id).toBe('last7')
    const tight = resolveWindow({ id: 'quarter' }, PULL, new Date(PULL.getTime() - 5 * 864e5))
    expect(tight.id).toBe('last7')
  })

  it('clamps a custom start date to the saved data and to the last refresh, and says so', () => {
    const early = win({ id: 'custom', since: '2020-01-01' })
    expect(early.sinceDay).toBe(early.minDay)
    expect(early.note).toMatch(/saved data starts/)
    const late = win({ id: 'custom', since: '2099-01-01' })
    expect(late.sinceDay).toBe(late.maxDay)
    expect(late.note).toMatch(/Latest start date/)
  })

  it('uses a custom start and end as given, includes the end day, and never goes past the last refresh', () => {
    const w = win({ id: 'custom', since: '2026-10-05', until: '2026-10-11' })
    expect([w.sinceDay, w.untilDay]).toEqual(['2026-10-05', '2026-10-11'])
    expect([w.end.getMonth(), w.end.getDate(), w.end.getHours()]).toEqual([9, 12, 0]) // up to Oct 12 00:00
    const open = win({ id: 'custom', since: '2026-10-05', until: '2099-01-01' })
    expect(open.end.getTime()).toBe(PULL.getTime())
    expect(win({ id: 'custom', since: '2026-10-05' }).end.getTime()).toBe(PULL.getTime())
  })

  it('moves an end date that is before the start date, and says so', () => {
    const w = win({ id: 'custom', since: '2026-10-20', until: '2026-10-10' })
    expect(w.untilDay).toBe(w.sinceDay)
    expect(w.note).toMatch(/cannot be before/)
  })

  it('rejects impossible dates', () => {
    expect(win({ id: 'custom', since: '2026-11-01' }).sinceDay).toBe('2026-11-01')
    expect(parseIsoDay('2026-02-30')).toBeNull()
    expect(parseIsoDay('26-1-1')).toBeNull()
    expect(parseIsoDay('2026-10-28')).toBeInstanceOf(Date)
  })

  it('labels the range with its first and last day', () => {
    expect(windowLabel({ start: new Date(2026, 9, 21), end: new Date(2026, 9, 28) })).toBe('Oct 21 to Oct 27, 2026')
  })

  describe('the saved choice', () => {
    afterEach(() => { delete globalThis.localStorage })
    const store = (v) => { globalThis.localStorage = { getItem: () => v, setItem() {} } }

    it('still loads a choice saved before end dates and compare existed', () => {
      store(JSON.stringify({ id: 'last14', since: null }))
      expect(loadRange()).toEqual({ id: 'last14', since: null, until: null, compare: 'off' })
    })
    it('keeps a saved end date and compare setting, and ignores junk', () => {
      store(JSON.stringify({ id: 'custom', since: '2026-10-01', until: '2026-10-09', compare: 'previous' }))
      expect(loadRange()).toEqual({ id: 'custom', since: '2026-10-01', until: '2026-10-09', compare: 'previous' })
      store('{not json')
      expect(loadRange()).toEqual(defaultRange())
      store(JSON.stringify({ id: 5 }))
      expect(loadRange()).toEqual(defaultRange())
    })
  })
})
