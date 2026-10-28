import { describe, it, expect } from 'vitest'
import cfgExample from '../../config/report.config.example.json'
import { buildReport, bucketOf, shortName, autoNote, pulledLabel } from './report.js'
import { resolveWindow, buildPresets, parseIsoDay, windowLabel } from './windows.js'
import { fiscalPosition } from './fiscal.js'

// Everything here is synthetic. No real names, tickets or Jira data are used, so the tests run on a fresh clone.
const config = cfgExample
const meta = { pulledAt: '2026-11-04T17:00:00.000Z', historyDays: 120, historyStart: '2026-07-07T17:00:00.000Z', source: 'example.atlassian.net' }
const PULL = new Date(meta.pulledAt)
const HISTORY_START = new Date(meta.historyStart)
const day = (n) => new Date(PULL.getTime() - n * 864e5).toISOString()
const T = (k, s, a, pair, u, r = null) => ({ k, t: `title ${k}`, s, a, pair, c: day(90), u, r })
const win = (range) => resolveWindow(range, PULL, HISTORY_START)

const [R0, R1, R2] = config.roster.map((r) => r.jiraName)
const sample = [
  T('EX-1', 'Closed', R0, [], day(1), day(1)),
  T('EX-2', 'Closed', R0, [], day(10), day(10)),
  T('EX-3', 'In Progress', R0, [], day(2)),
  T('EX-4', 'Blocked', R1, [], day(40)),
  T('EX-5', 'PM Review', R1, [R2], day(3)),
  T('EX-6', 'Open', R2, [], day(60)),
  T('EX-7', 'Blocked', R2, [], day(1)),
  T('EX-8', 'Closed', R1, [], day(20), day(20)),
  T('EX-9', 'Open', 'Dev, Dee', [R0], day(5)),
]
const data = { version: 2, meta, tickets: sample }
const tile = (r, id) => r.kpis.find((k) => k.id === id).value

describe('a sample report across every range', () => {
  it('covers every roster member in every range, active or not', () => {
    for (const id of ['last7', 'last14', 'last30', 'period', 'quarter']) {
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

  it('shows every open blocked ticket whatever the range', () => {
    for (const id of ['last7', 'last30', 'quarter']) {
      expect(buildReport(data, win({ id }), config).blocked.map((b) => b.issue.k).sort()).toEqual(['EX-4', 'EX-7'])
    }
  })

  it('marks a blocked ticket with no recent update', () => {
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
const rep = (tickets, id = 'last7') => buildReport({ version: 2, meta, tickets }, win({ id }), cfg)

describe('buildReport rules', () => {
  it('counts a closed ticket by resolved date and an open ticket by updated date', () => {
    const r = rep([
      T('X-1', 'Closed', 'A, Ann', [], '2026-11-03T12:00:00.000Z', '2026-11-03T12:00:00.000Z'), // closed in range
      T('X-2', 'Closed', 'A, Ann', [], '2026-11-03T12:00:00.000Z', '2026-10-01T12:00:00.000Z'), // closed long ago, edited since
      T('X-3', 'Open', 'A, Ann', [], '2026-11-02T12:00:00.000Z'), // open, updated in range
      T('X-4', 'Open', 'A, Ann', [], '2026-09-01T12:00:00.000Z'), // open, quiet
    ])
    const ann = r.rows.find((d) => d.name === 'A, Ann')
    expect(ann.own.map((i) => i.k).sort()).toEqual(['X-1', 'X-3'])
    expect(ann.idle.map((i) => i.k)).toEqual(['X-4'])
    expect(tile(r, 'closed')).toBe(1)
  })

  it('moves a ticket out of the range when the range is narrower than its last update', () => {
    const tickets = [T('X-1', 'Open', 'A, Ann', [], '2026-10-20T12:00:00.000Z')]
    expect(rep(tickets, 'last7').active).toHaveLength(0)
    expect(rep(tickets, 'last30').active).toHaveLength(1)
  })

  it('credits a paired designer and records the assignee', () => {
    const r = rep([T('X-3', 'In Progress', 'Dev, Dee', ['B, Bo'], '2026-11-03T12:00:00.000Z')])
    const bo = r.rows.find((d) => d.name === 'B, Bo')
    expect(bo.own).toHaveLength(0)
    expect(bo.pair[0]).toMatchObject({ k: 'X-3', a: 'Dev, Dee' })
  })

  it('shows a roster member with no tickets at all in the no-activity table', () => {
    const r = rep([T('X-1', 'Open', 'A, Ann', [], '2026-11-03T12:00:00.000Z')])
    expect(r.quiet.map((d) => d.name)).toEqual(['B, Bo'])
    expect(r.quiet[0].note).toMatch(/No open assigned or paired tickets/)
  })

  it('says how many open tickets a quiet designer still has', () => {
    const r = rep([T('X-1', 'Open', 'B, Bo', [], '2026-08-01T12:00:00.000Z')])
    expect(r.quiet.find((d) => d.name === 'B, Bo').note).toBe('1 assigned ticket and 0 paired tickets open. None were updated in the last 7 days.')
  })

  it('ignores tickets that involve nobody on the roster', () => {
    const r = rep([T('X-2', 'Blocked', 'Z, Zed', [], '2026-11-03T12:00:00.000Z')])
    expect(r.blocked).toHaveLength(0)
    expect(r.active).toHaveLength(0)
  })

  it('lists open blocked tickets and marks the ones with no recent update', () => {
    const r = rep([
      T('X-1', 'Blocked', 'A, Ann', [], '2026-11-03T12:00:00.000Z'),
      T('X-2', 'Blocked', 'A, Ann', [], '2026-08-01T12:00:00.000Z'),
    ])
    expect(r.blocked.map((b) => [b.issue.k, b.movedThisWeek])).toEqual([['X-1', true], ['X-2', false]])
  })

  it('treats an unknown Jira status as the default bucket', () => {
    expect(bucketOf({ s: 'Some New Status' }, config)).toBe('open')
    expect(bucketOf({ s: 'Ready for Test' }, config)).toBe('review')
  })
})

describe('notes and formatting', () => {
  it('writes a factual line from statuses only, naming the range', () => {
    const items = [{ k: 'X-1', s: 'Closed' }, { k: 'X-2', s: 'Closed' }, { k: 'X-3', s: 'PM Review' }, { k: 'X-4', s: 'Blocked' }]
    expect(autoNote(items, 'in the last 14 days', config)).toBe('Updated in the last 14 days: 2 closed, 1 in PM review. Blocked: X-4.')
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

  it('returns null outside the known years instead of guessing', () => {
    expect(at(2026, 1, 31)).toBeNull()
    expect(at(2028, 6, 1)).toBeNull()
  })
})

describe('date ranges', () => {
  it('offers 7, 14 and 30 days plus this fiscal period and quarter, with dates', () => {
    const presets = buildPresets(new Date(2026, 9, 28, 13, 0), new Date(2026, 5, 30))
    expect(presets.map((p) => p.label)).toEqual(['Last 7 days', 'Last 14 days', 'Last 30 days', 'This period (P10)', 'This quarter (Q3)'])
    expect(presets.every((p) => !p.disabled)).toBe(true)
  })

  it('disables a preset that reaches back past the saved data, with a reason', () => {
    const presets = buildPresets(new Date(2026, 9, 28, 13, 0), new Date(2026, 9, 20))
    const q = presets.find((p) => p.id === 'quarter')
    expect(q.disabled).toBe(true)
    expect(q.reason).toMatch(/saved data only goes back/)
  })

  it('hides the fiscal presets when the date is outside the known calendar', () => {
    expect(buildPresets(new Date(2029, 5, 1), new Date(2029, 0, 1)).map((p) => p.id)).toEqual(['last7', 'last14', 'last30'])
  })

  it('falls back to the first preset for an unknown or unavailable choice', () => {
    expect(win({ id: 'nonsense' }).id).toBe('last7')
    const tight = resolveWindow({ id: 'quarter' }, PULL, new Date(PULL.getTime() - 5 * 864e5))
    expect(tight.id).toBe('last7')
  })

  it('clamps a custom start date to the saved data and to today, and says so', () => {
    const early = win({ id: 'custom', since: '2020-01-01' })
    expect(early.sinceDay).toBe(early.minDay)
    expect(early.note).toMatch(/saved data starts/)
    const late = win({ id: 'custom', since: '2099-01-01' })
    expect(late.sinceDay).toBe(late.maxDay)
    expect(late.note).toMatch(/Latest start date/)
  })

  it('uses a valid custom date as given and rejects impossible dates', () => {
    const ok = win({ id: 'custom', since: '2026-11-01' })
    expect(ok.id).toBe('custom')
    expect(ok.sinceDay).toBe('2026-11-01')
    expect(parseIsoDay('2026-02-30')).toBeNull()
    expect(parseIsoDay('26-1-1')).toBeNull()
    expect(parseIsoDay('2026-10-28')).toBeInstanceOf(Date)
  })

  it('labels the range with its dates', () => {
    expect(windowLabel({ start: new Date(2026, 9, 21), end: new Date(2026, 9, 28) })).toBe('Oct 21 to Oct 28, 2026')
  })
})
