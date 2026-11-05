import { describe, it, expect, afterEach } from 'vitest'
import { resolveWorkWindow, countWorkDays, firstWorkDay, loadWorkWindow, saveWorkWindow, workWindowGroups, DEFAULT_CHOICE } from './workWindow.js'
import { toIsoDay } from './windows.js'

// 2026-10-30 is a Friday. Months are zero-based in Date.
const FRI = new Date(2026, 9, 30, 14, 25)
const SAT = new Date(2026, 10, 7)

describe('work days', () => {
  it('counts Monday to Friday, both ends inclusive', () => {
    expect(countWorkDays(new Date(2026, 9, 30), new Date(2026, 10, 26))).toBe(20) // 1 + 5 + 5 + 5 + 4
    expect(countWorkDays(new Date(2026, 9, 30), new Date(2026, 10, 12))).toBe(10)
    expect(countWorkDays(new Date(2026, 10, 7), new Date(2026, 10, 8))).toBe(0) // a weekend
  })

  it('starts on the next Monday when today is a weekend', () => {
    expect(toIsoDay(firstWorkDay(SAT))).toBe('2026-11-09')
    expect(toIsoDay(firstWorkDay(FRI))).toBe('2026-10-30')
  })
})

describe('presets', () => {
  it('next 4 weeks from Fri Oct 30 ends Thu Nov 26 with 20 work days', () => {
    const w = resolveWorkWindow({ id: 'next4' }, FRI)
    expect(w.ok).toBe(true)
    expect(toIsoDay(w.start)).toBe('2026-10-30')
    expect(toIsoDay(w.end)).toBe('2026-11-26')
    expect(w.workDays).toBe(20)
  })

  it('next 2, 8 and 12 weeks', () => {
    expect(resolveWorkWindow({ id: 'next2' }, FRI).workDays).toBe(10)
    expect(toIsoDay(resolveWorkWindow({ id: 'next2' }, FRI).end)).toBe('2026-11-12')
    expect(resolveWorkWindow({ id: 'next8' }, FRI).workDays).toBe(40)
    expect(resolveWorkWindow({ id: 'next12' }, FRI).workDays).toBe(60)
  })
})

// FY2026 Q3 is Aug 16 to Nov 7, 2026 and Q4 is Nov 8 2026 to Jan 30 2027 (12 weeks). FY2027 dates are assumed.
describe('this week and next week (Sunday to Saturday)', () => {
  const w = (id, today) => resolveWorkWindow({ id }, today)

  it('this week on a Friday covers only what is left: Fri and Sat, 1 work day', () => {
    const r = w('thisweek', FRI)
    expect(toIsoDay(r.start)).toBe('2026-10-30')
    expect(toIsoDay(r.end)).toBe('2026-10-31')
    expect(r.workDays).toBe(1)
  })

  it('this week on a Wednesday has 3 work days left', () => {
    const r = w('thisweek', new Date(2026, 10, 4, 9, 0))
    expect(toIsoDay(r.end)).toBe('2026-11-07')
    expect(r.workDays).toBe(3)
  })

  it('this week on a Sunday is the whole coming week', () => {
    const r = w('thisweek', new Date(2026, 10, 8))
    expect(toIsoDay(r.start)).toBe('2026-11-08')
    expect(toIsoDay(r.end)).toBe('2026-11-14')
    expect(r.workDays).toBe(5)
  })

  it('this week on a Saturday has nothing left, with a reason that points to next week', () => {
    const r = w('thisweek', SAT)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/Next week/)
  })

  it('next week is the following Sunday to Saturday, from any day', () => {
    for (const today of [FRI, SAT, new Date(2026, 10, 1), new Date(2026, 10, 4)]) {
      const r = w('nextweek', today)
      expect(r.start.getDay()).toBe(0)
      expect(r.end.getDay()).toBe(6)
      expect(r.workDays).toBe(5)
      expect(r.start > today).toBe(true)
    }
    expect(toIsoDay(w('nextweek', FRI).start)).toBe('2026-11-01')
    expect(toIsoDay(w('nextweek', SAT).start)).toBe('2026-11-08')
  })
})

describe('this quarter and next quarter (fiscal)', () => {
  const w = (id, today) => resolveWorkWindow({ id }, today)

  it('this quarter runs from today to the end of the fiscal quarter', () => {
    const r = w('thisquarter', FRI)
    expect(r.label).toBe('This quarter (Q3)')
    expect(toIsoDay(r.start)).toBe('2026-10-30')
    expect(toIsoDay(r.end)).toBe('2026-11-07')
    expect(r.workDays).toBe(6)
    expect(r.assumed).toBe(false)
  })

  it('next quarter is the whole following quarter: 12 weeks, 60 work days', () => {
    const r = w('nextquarter', FRI)
    expect(r.label).toBe('Next quarter (Q4)')
    expect(toIsoDay(r.start)).toBe('2026-11-08')
    expect(toIsoDay(r.end)).toBe('2027-01-30')
    expect(r.workDays).toBe(60)
    expect(r.assumed).toBe(false)
  })

  it('rolls over on its own: on the first day of Q4, this quarter is Q4 and next is FY2027 Q1 (assumed dates)', () => {
    const q4 = new Date(2026, 10, 8)
    expect(w('thisquarter', q4).label).toBe('This quarter (Q4)')
    expect(w('thisquarter', q4).workDays).toBe(60)
    const next = w('nextquarter', q4)
    expect(next.label).toBe('Next quarter (Q1)')
    expect(toIsoDay(next.start)).toBe('2027-01-31')
    expect(next.assumed).toBe(true)
  })

  it('has no next quarter at the end of the calendar, and no quarter at all after it', () => {
    expect(w('nextquarter', new Date(2027, 11, 1)).ok).toBe(false)
    expect(w('thisquarter', new Date(2027, 11, 1)).ok).toBe(true)
    expect(w('thisquarter', new Date(2028, 2, 1)).ok).toBe(false)
    expect(w('nextquarter', new Date(2028, 2, 1)).ok).toBe(false)
  })

  it('this quarter on the last Saturday of the quarter has no work days left', () => {
    expect(w('thisquarter', new Date(2026, 10, 7)).ok).toBe(false)
  })
})

describe('the dropdown groups', () => {
  const ids = (today) => workWindowGroups(today).flatMap((g) => g.items.map((i) => i.id))

  it('offers rolling, calendar and fiscal choices, in that order', () => {
    expect(workWindowGroups(FRI).map((g) => g.label)).toEqual(['Rolling, from today', 'Calendar', 'Fiscal'])
    expect(ids(FRI)).toEqual(['next2', 'next4', 'next8', 'next12', 'thisweek', 'nextweek', 'thisquarter', 'nextquarter'])
  })

  it('labels the quarters with their number and flags assumed dates', () => {
    const items = Object.fromEntries(workWindowGroups(new Date(2026, 10, 8)).flatMap((g) => g.items).map((i) => [i.id, i]))
    expect(items.thisquarter.label).toBe('This quarter (Q4)')
    expect(items.nextquarter.label).toBe('Next quarter (Q1)')
    expect(items.nextquarter.assumed).toBe(true)
    expect(items.thisquarter.assumed).toBe(false)
  })

  it('disables a choice that cannot be used today, with the reason', () => {
    const items = Object.fromEntries(workWindowGroups(SAT).flatMap((g) => g.items).map((i) => [i.id, i]))
    expect(items.thisweek.disabled).toBe(true)
    expect(items.thisweek.reason).toMatch(/Next week/)
    expect(items.nextweek.disabled).toBe(false)
    expect(items.next4.disabled).toBe(false)
  })
})

describe('custom ranges', () => {
  it('clamps a start before today to today', () => {
    const w = resolveWorkWindow({ id: 'custom', since: '2026-10-01', until: '2026-11-06' }, FRI)
    expect(w.ok).toBe(true)
    expect(w.clamped).toBe(true)
    expect(toIsoDay(w.start)).toBe('2026-10-30')
    expect(w.workDays).toBe(6)
  })

  it('keeps a future start', () => {
    const w = resolveWorkWindow({ id: 'custom', since: '2026-11-09', until: '2026-11-13' }, FRI)
    expect(w.clamped).toBe(false)
    expect(w.workDays).toBe(5)
  })

  it('rejects a range entirely in the past, with a reason', () => {
    const w = resolveWorkWindow({ id: 'custom', since: '2026-10-01', until: '2026-10-29' }, FRI)
    expect(w.ok).toBe(false)
    expect(w.past).toBe(true)
    expect(w.reason).toMatch(/Past ranges/)
  })

  it('accepts a range that ends today', () => {
    const w = resolveWorkWindow({ id: 'custom', since: '2026-10-20', until: '2026-10-30' }, FRI)
    expect(w.ok).toBe(true)
    expect(w.workDays).toBe(1)
  })

  it('rejects malformed or reversed ranges and unknown ids', () => {
    expect(resolveWorkWindow({ id: 'custom', since: 'nope', until: '2026-11-06' }, FRI).ok).toBe(false)
    expect(resolveWorkWindow({ id: 'custom', since: '2026-11-09', until: '2026-11-02' }, FRI).ok).toBe(false)
    expect(resolveWorkWindow({ id: 'last7' }, FRI).ok).toBe(false)
  })
})

describe('saved choice', () => {
  const store = {}
  const fake = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v } }
  afterEach(() => { delete globalThis.localStorage; for (const k of Object.keys(store)) delete store[k] })

  it('falls back to next 4 weeks when nothing is usable', () => {
    globalThis.localStorage = fake
    expect(loadWorkWindow(FRI)).toEqual(DEFAULT_CHOICE)
    store['dar.workWindow'] = '{not json'
    expect(loadWorkWindow(FRI)).toEqual(DEFAULT_CHOICE)
    store['dar.workWindow'] = JSON.stringify({ id: 'last7' })
    expect(loadWorkWindow(FRI)).toEqual(DEFAULT_CHOICE)
  })

  it('falls back when a saved custom range has slipped into the past', () => {
    globalThis.localStorage = fake
    saveWorkWindow({ id: 'custom', since: '2026-10-01', until: '2026-10-20' })
    expect(loadWorkWindow(FRI)).toEqual(DEFAULT_CHOICE)
  })

  it('round-trips a preset and a live custom range', () => {
    globalThis.localStorage = fake
    saveWorkWindow({ id: 'next8' })
    expect(loadWorkWindow(FRI)).toEqual({ id: 'next8' })
    for (const id of ['thisweek', 'nextweek', 'thisquarter', 'nextquarter']) {
      saveWorkWindow({ id })
      expect(loadWorkWindow(FRI)).toEqual({ id })
    }
    saveWorkWindow({ id: 'custom', since: '2026-11-09', until: '2026-11-20' })
    expect(loadWorkWindow(FRI)).toEqual({ id: 'custom', since: '2026-11-09', until: '2026-11-20' })
  })

  it('does not throw when storage is blocked', () => {
    globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    expect(loadWorkWindow(FRI)).toEqual(DEFAULT_CHOICE)
    expect(() => saveWorkWindow({ id: 'next2' })).not.toThrow()
  })
})
