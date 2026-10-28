import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import cfgExample from '../../config/report.config.example.json'
import { buildWeeks, velocity, openByStatus, closedByDesigner, weekStart, effectiveSpan, loadSpanChoice, defaultSpanChoice, presetLabel, spanText } from './weeks.js'

// Synthetic data only. Times are built from local dates so the tests hold in any time zone.
// 2026-11-01 is a Sunday, so the weeks below start Oct 18, Oct 25 and Nov 1; the pull is Wed Nov 4.
const cfg = cfgExample
const [R0, R1, R2] = cfg.roster.map((r) => r.jiraName)
const at = (m, d, h = 12, min = 0) => new Date(2026, m - 1, d, h, min).toISOString()
const meta = { pulledAt: at(11, 4), historyDays: 120, historyStart: at(7, 7), source: 'example.atlassian.net' }
const T = (k, s, a, pair, c, r = null) => ({ k, t: `title ${k}`, s, a, pair, c, u: r ?? c, r })
const make = (tickets) => ({ version: 2, meta, tickets })
const week = (res, label) => res.weeks.find((w) => w.label === label)

describe('weekStart', () => {
  it('returns the Sunday on or before a date, at local midnight', () => {
    expect(weekStart(new Date(2026, 10, 4, 15)).getTime()).toBe(new Date(2026, 10, 1).getTime())
    expect(weekStart(new Date(2026, 10, 1, 0, 0)).getTime()).toBe(new Date(2026, 10, 1).getTime())
    expect(weekStart(new Date(2026, 9, 31, 23, 59)).getTime()).toBe(new Date(2026, 9, 25).getTime())
  })

  it('stays on a Sunday across the fall daylight-saving change (Nov 1, 2026 in the US)', () => {
    expect(weekStart(new Date(2026, 10, 3)).getDay()).toBe(0)
    expect(weekStart(new Date(2026, 9, 31)).getDay()).toBe(0)
  })
})

describe('buildWeeks', () => {
  it('puts Saturday 23:59 in one week and Sunday 00:00 in the next', () => {
    const res = buildWeeks(make([
      T('EX-1', 'Closed', R0, [], at(10, 1), at(10, 31, 23, 59)),
      T('EX-2', 'Closed', R0, [], at(10, 1), at(11, 1, 0, 0)),
    ]), '4', cfg)
    expect(week(res, 'Oct 25').closed).toBe(1)
    expect(week(res, 'Nov 1').closed).toBe(1)
  })

  it('counts a ticket opened and closed in the same week in both columns', () => {
    const res = buildWeeks(make([T('EX-1', 'Closed', R0, [], at(11, 2), at(11, 3))]), '4', cfg)
    const w = week(res, 'Nov 1')
    expect([w.opened, w.closed, w.net]).toEqual([1, 1, 0])
  })

  it('counts opened by created date and closed by resolved date, even in different weeks', () => {
    const res = buildWeeks(make([T('EX-1', 'Closed', R0, [], at(10, 20), at(11, 3))]), '4', cfg)
    expect(week(res, 'Oct 18').opened).toBe(1)
    expect(week(res, 'Oct 18').closed).toBe(0)
    expect(week(res, 'Nov 1').closed).toBe(1)
  })

  it('flags the week in progress and ends it at the pull', () => {
    const res = buildWeeks(make([]), '4', cfg)
    const last = res.weeks.at(-1)
    expect(last.label).toBe('Nov 1')
    expect(last.partial).toBe(true)
    expect(last.end.getTime()).toBe(new Date(meta.pulledAt).getTime())
    expect(res.weeks.slice(0, -1).every((w) => !w.partial)).toBe(true)
  })

  it('shows the requested number of complete weeks plus the week in progress', () => {
    expect(buildWeeks(make([]), '4', cfg).weeks).toHaveLength(5)
    expect(buildWeeks(make([]), '8', cfg).weeks).toHaveLength(9)
  })

  it('drops weeks that start before the saved history, and starts at the first full day', () => {
    const res = buildWeeks(make([]), 'all', cfg)
    // history starts Tue Jul 7, so the week of Jul 5 is left out and the first week is Jul 12
    expect(res.weeks[0].label).toBe('Jul 12')
    expect(res.weeks.every((w) => w.start >= new Date(2026, 6, 8))).toBe(true)
    expect(res.available).toBe(res.weeks.length - 1)
  })

  it('ignores tickets that are not on the roster', () => {
    const res = buildWeeks(make([
      T('EX-1', 'Closed', 'Dev, Dee', [], at(11, 2), at(11, 3)),
      T('EX-2', 'Closed', 'Dev, Dee', [R1], at(11, 2), at(11, 3)),
    ]), '4', cfg)
    expect(week(res, 'Nov 1').closed).toBe(1)
  })

  it('returns zeros, not NaN, for empty data', () => {
    const res = buildWeeks(make([]), '4', cfg)
    expect(res.weeks.every((w) => w.opened === 0 && w.closed === 0 && w.net === 0)).toBe(true)
  })
})

describe('the weeks-shown choice', () => {
  const avail = (n) => buildWeeks(make([]), 'all', cfg).available

  it('shows 1 or 2 complete weeks plus the week in progress', () => {
    expect(buildWeeks(make([]), '1', cfg).weeks).toHaveLength(2)
    expect(buildWeeks(make([]), '2', cfg).weeks).toHaveLength(3)
    expect(buildWeeks(make([]), '1', cfg).weeks.at(-1).partial).toBe(true)
  })

  it('velocity still works with one complete week', () => {
    const v = velocity(buildWeeks(make([T('EX-1', 'Closed', R0, [], at(10, 27), at(10, 28))]), '1', cfg))
    expect([v.averageWeeks, v.average, v.best, v.low]).toEqual([1, 1, 1, 1])
  })

  it('passes a preset through, and keeps a custom number between 1 and the weeks saved', () => {
    const a = avail()
    expect(effectiveSpan({ choice: '4', custom: 99 }, a)).toBe('4')
    expect(effectiveSpan({ choice: 'all', custom: 3 }, a)).toBe('all')
    expect(effectiveSpan({ choice: 'custom', custom: 3 }, a)).toBe('3')
    expect(effectiveSpan({ choice: 'custom', custom: 9999 }, a)).toBe(String(a))
    expect(effectiveSpan({ choice: 'custom', custom: 0 }, a)).toBe('1')
    expect(effectiveSpan({ choice: 'custom', custom: -4 }, a)).toBe('1')
    expect(effectiveSpan({ choice: 'custom', custom: 2.5 }, a)).toBe('1')
    expect(effectiveSpan({ choice: 'custom', custom: NaN }, a)).toBe('1')
    expect(effectiveSpan({ choice: 'custom', custom: 5 }, 0)).toBe('1')
  })

  it('a custom number of weeks builds that many weeks', () => {
    expect(buildWeeks(make([]), effectiveSpan({ choice: 'custom', custom: 6 }, avail()), cfg).weeks).toHaveLength(7)
  })

  it('words singular and plural correctly', () => {
    expect(presetLabel('1', 20)).toBe('Last 1 week')
    expect(presetLabel('2', 20)).toBe('Last 2 weeks')
    expect(presetLabel('all', 20)).toBe('All saved weeks (20)')
    expect(spanText('1', 20)).toBe('the last 1 week')
    expect(spanText('6', 20)).toBe('the last 6 weeks')
    expect(spanText('all', 20)).toBe('all saved weeks')
  })

  describe('the saved choice', () => {
    afterEach(() => { delete globalThis.localStorage })
    const store = (v) => { globalThis.localStorage = { getItem: () => v, setItem() {} } }

    it('loads a saved preset or custom choice', () => {
      store(JSON.stringify({ choice: 'custom', custom: 10 }))
      expect(loadSpanChoice()).toEqual({ choice: 'custom', custom: 10 })
      store(JSON.stringify({ choice: '2', custom: 4 }))
      expect(loadSpanChoice()).toEqual({ choice: '2', custom: 4 })
    })
    it('still reads the plain text an earlier version saved', () => {
      store('12')
      expect(loadSpanChoice()).toEqual({ choice: '12', custom: defaultSpanChoice().custom })
      store('all')
      expect(loadSpanChoice().choice).toBe('all')
    })
    it('falls back to 8 weeks for junk, and repairs a bad custom number', () => {
      for (const junk of ['{nope', 'banana', JSON.stringify({ choice: 'banana' }), null]) {
        store(junk)
        expect(loadSpanChoice()).toEqual(defaultSpanChoice())
      }
      store(JSON.stringify({ choice: 'custom', custom: -3 }))
      expect(loadSpanChoice()).toEqual({ choice: 'custom', custom: defaultSpanChoice().custom })
    })
  })
})

describe('velocity', () => {
  const closedIn = (n, m, d) => Array.from({ length: n }, (_, i) => T(`EX-${m}${d}${i}`, 'Closed', R0, [], at(m, d - 1), at(m, d)))

  it('averages the last four complete weeks and leaves out the week in progress', () => {
    const res = buildWeeks(make([
      ...closedIn(2, 10, 20), // week of Oct 18
      ...closedIn(4, 10, 27), // week of Oct 25
      ...closedIn(9, 11, 3), // week in progress: must not count
    ]), '4', cfg)
    const v = velocity(res)
    expect(v.averageWeeks).toBe(4)
    // complete weeks Oct 4, Oct 11, Oct 18, Oct 25 hold 0, 0, 2, 4
    expect(v.average).toBe(1.5)
    expect(v.best).toBe(4)
    expect(v.low).toBe(0)
  })

  it('takes the median days from created to resolved over the shown weeks', () => {
    const res = buildWeeks(make([
      T('EX-1', 'Closed', R0, [], at(10, 25), at(10, 27)), // 2 days
      T('EX-2', 'Closed', R0, [], at(10, 20), at(10, 27)), // 7 days
      T('EX-3', 'Closed', R0, [], at(10, 1), at(10, 28)), // 27 days
    ]), '4', cfg)
    expect(velocity(res)).toMatchObject({ medianDays: 7, closedCount: 3 })
  })

  it('reports null, not NaN, when nothing closed', () => {
    const v = velocity(buildWeeks(make([]), '4', cfg))
    expect(v.medianDays).toBeNull()
    expect(v.closedCount).toBe(0)
    expect(v.average).toBe(0)
  })
})

describe('openByStatus', () => {
  it('counts open tickets by status bucket and leaves out closed ones', () => {
    const o = openByStatus(make([
      T('EX-1', 'Blocked', R0, [], at(10, 1)),
      T('EX-2', 'In Progress', R0, [], at(10, 1)),
      T('EX-3', 'In Progress', R1, [], at(10, 1)),
      T('EX-4', 'Ready for Test', R1, [], at(10, 1)),
      T('EX-5', 'Open', R2, [], at(10, 1)),
      T('EX-6', 'Closed', R2, [], at(10, 1), at(10, 30)),
      T('EX-7', 'Open', 'Dev, Dee', [], at(10, 1)),
    ]), cfg)
    expect(o.total).toBe(5)
    const by = Object.fromEntries(o.slices.map((s) => [s.bucket, s.count]))
    expect(by).toEqual({ blocked: 1, review: 1, prog: 2, open: 1 })
  })

  it('gives zero slices, not NaN, for empty data', () => {
    const o = openByStatus(make([]), cfg)
    expect(o.total).toBe(0)
    expect(o.slices.every((s) => s.count === 0)).toBe(true)
  })
})

describe('closedByDesigner', () => {
  it('separates assigned from paired and sorts by total', () => {
    const res = buildWeeks(make([
      T('EX-1', 'Closed', R0, [], at(10, 27), at(10, 28)),
      T('EX-2', 'Closed', R0, [R1], at(10, 27), at(10, 28)),
      T('EX-3', 'Closed', 'Dev, Dee', [R1], at(10, 27), at(10, 29)),
      T('EX-4', 'Open', R2, [], at(10, 27)),
    ]), '4', cfg)
    const c = closedByDesigner(res, cfg)
    expect(c.rows[0]).toMatchObject({ name: R0, assigned: 2, paired: 0, total: 2 })
    expect(c.rows[1]).toMatchObject({ name: R1, assigned: 0, paired: 2, total: 2 })
    expect(c.rows.find((r) => r.name === R2).total).toBe(0)
    expect(c.none).toBe(1)
    expect(c.max).toBe(2)
  })

  it('leaves out tickets resolved before the first shown week', () => {
    const res = buildWeeks(make([T('EX-1', 'Closed', R0, [], at(9, 1), at(9, 2))]), '4', cfg)
    expect(closedByDesigner(res, cfg).rows.every((r) => r.total === 0)).toBe(true)
  })
})

// Property checks on the real saved data. Skipped on a fresh clone, where report.json does not exist.
// Nothing from the file is printed or asserted by value, so no real data leaks into output or the repo.
const REAL = new URL('../../public/data/report.json', import.meta.url)
describe.skipIf(!existsSync(REAL))('checked-in data', () => {
  const real = existsSync(REAL) ? JSON.parse(readFileSync(REAL, 'utf8')) : null

  it('weekly closed adds up to the tickets resolved in those weeks', async () => {
    const { default: realCfg } = await import('./config.js')
    const res = buildWeeks(real, 'all', realCfg)
    const names = realCfg.roster.map((r) => r.jiraName)
    const mine = real.tickets.filter((t) => names.includes(t.a) || t.pair.some((p) => names.includes(p)))
    const from = res.weeks[0].start.getTime()
    const direct = mine.filter((t) => t.r && new Date(t.r).getTime() >= from && new Date(t.r) <= res.anchor).length
    expect(res.weeks.reduce((a, w) => a + w.closed, 0)).toBe(direct)
    expect(res.weeks.reduce((a, w) => a + w.opened, 0)).toBeLessThanOrEqual(mine.length)
  })

  it('open-by-status total equals the open roster tickets', async () => {
    const { default: realCfg } = await import('./config.js')
    const o = openByStatus(real, realCfg)
    expect(o.slices.reduce((a, s) => a + s.count, 0)).toBe(o.total)
  })
})
