import { describe, it, expect } from 'vitest'
import { bandFor, personLoad, teamLoad, projectQueue, leftOutCount, buildWorkload, settingsFor } from './workload.js'
import { resolveWorkWindow } from './workWindow.js'
import { checkWorkloadConfig } from './workloadConfig.js'
import { toIsoDay } from './windows.js'

// All names and keys here are made up. 2026-10-30 is a Friday.
const TODAY = new Date(2026, 9, 30, 14, 25)
const cfg = {
  roster: [{ jiraName: 'Doe, Jamie' }, { jiraName: 'Roe, Alex' }],
  statusBuckets: { 'In Progress': 'prog', 'To Do': 'open', Done: 'closed', Blocked: 'blocked', 'PM Review': 'review' },
  defaultBucket: 'open',
  workload: { sizeFieldId: 'customfield_90001', rankFieldId: 'customfield_90002' },
}
const wl = {
  sizeDays: { XS: 1.5, SM: 5, MED: 10, LG: 20, XL: 30 },
  daysPerWeek: 5,
  focus: 0.8,
  overrides: {},
  excludedTypes: ['Epic', 'Program Epic'],
}
const tk = (k, o = {}) => ({ k, t: 'Task', s: 'In Progress', a: 'Doe, Jamie', pair: [], c: '2026-10-01T00:00:00Z', u: '2026-10-20T00:00:00Z', r: null, h: [], y: 'Story', z: null, d: null, rk: null, ...o })
const win4 = resolveWorkWindow({ id: 'next4' }, TODAY)
const load = (tickets, name = 'Doe, Jamie', win = win4, w = wl) => personLoad(name, tickets, cfg, w, win, TODAY)
const day = (d) => (d ? toIsoDay(d) : null)

describe('the worked example', () => {
  const tickets = [
    tk('ABC-1', { z: 'SM', rk: 'a' }),
    tk('ABC-4', { z: 'MED', rk: 'b', d: '2026-10-30' }),
    tk('ABC-2', { z: null, rk: 'c' }),
  ]

  it('next 4 weeks: 15d assigned of 16d, 94%, 1d free, 3.8 weeks', () => {
    const r = load(tickets)
    expect(r.capacity).toBe(16)
    expect(r.assigned).toBe(15)
    expect(r.pctRounded).toBe(94)
    expect(r.free).toBe(1)
    expect(r.over).toBe(0)
    expect(r.weeksOfWork).toBeCloseTo(3.75, 5)
    expect(r.unsized).toBe(1)
    expect(r.band).toBe('near')
  })

  it('queue: first ticket finishes Nov 9, second Nov 25 and is late, queue clears Nov 25', () => {
    const r = load(tickets)
    const byKey = Object.fromEntries(r.items.map((i) => [i.k, i]))
    expect(day(byKey['ABC-1'].start)).toBe('2026-10-30')
    expect(day(byKey['ABC-1'].finish)).toBe('2026-11-09')
    expect(byKey['ABC-1'].late).toBe(false)
    expect(day(byKey['ABC-4'].start)).toBe('2026-11-09')
    expect(day(byKey['ABC-4'].finish)).toBe('2026-11-25')
    expect(byKey['ABC-4'].late).toBe(true)
    expect(day(r.clears)).toBe('2026-11-25')
    expect(r.late).toBe(1)
  })

  it('unsized tickets are skipped by the queue', () => {
    const r = load(tickets)
    const u = r.items.find((i) => i.k === 'ABC-2')
    expect(u.start).toBeNull()
    expect(u.finish).toBeNull()
    expect(u.late).toBe(false)
  })

  it('next 2 weeks: 8d capacity, 188%, 7d over', () => {
    const r = load(tickets, 'Doe, Jamie', resolveWorkWindow({ id: 'next2' }, TODAY))
    expect(r.capacity).toBe(8)
    expect(r.pctRounded).toBe(188)
    expect(r.over).toBe(7)
    expect(r.free).toBe(0)
    expect(r.band).toBe('full')
  })

  it('assigned work does not depend on the window', () => {
    const a = load(tickets, 'Doe, Jamie', resolveWorkWindow({ id: 'next2' }, TODAY))
    const b = load(tickets, 'Doe, Jamie', resolveWorkWindow({ id: 'next12' }, TODAY))
    expect(a.assigned).toBe(b.assigned)
  })
})

describe('the default week is 40 hours, Monday to Friday', () => {
  // The config check fills in 5 days a week at 100% focus when the block does not say.
  const defaults = checkWorkloadConfig({ sizeFieldId: 'customfield_90001', rankFieldId: 'customfield_90002' }).value

  it('gives 5 days of capacity a week and a full day per work day', () => {
    expect(settingsFor('Doe, Jamie', defaults)).toMatchObject({ daysPerWeek: 5, focus: 1, weeklyDays: 5, perDayH: 100 })
    const r = load([tk('ABC-1', { z: 'SM' })], 'Doe, Jamie', win4, defaults)
    expect(r.capacity).toBe(20) // 20 work days in 4 weeks
    expect(r.pctRounded).toBe(25) // 5d of 20d
    expect(r.weeksOfWork).toBe(1)
  })

  it('a one-week ticket takes exactly one work week: Fri Oct 30 to Thu Nov 5', () => {
    const r = load([tk('ABC-1', { z: 'SM' })], 'Doe, Jamie', win4, defaults)
    expect(day(r.items[0].start)).toBe('2026-10-30')
    expect(day(r.items[0].finish)).toBe('2026-11-05')
  })

  it('a lower focus for one person still works as an override', () => {
    const w = { ...defaults, overrides: { 'Doe, Jamie': { focus: 0.4 } } }
    expect(settingsFor('Doe, Jamie', w).weeklyDays).toBe(2)
    expect(settingsFor('Roe, Alex', w).weeklyDays).toBe(5)
  })
})

describe('which tickets count', () => {
  it('splits in progress from queued by bucket', () => {
    const r = load([
      tk('ABC-1', { z: 'SM', s: 'In Progress' }),
      tk('ABC-2', { z: 'SM', s: 'PM Review' }),
      tk('ABC-3', { z: 'SM', s: 'Blocked' }),
      tk('ABC-4', { z: 'SM', s: 'To Do' }),
    ])
    expect(r.progDays).toBe(15)
    expect(r.queuedDays).toBe(5)
  })

  it('leaves out Epics, closed work and resolved work', () => {
    const r = load([
      tk('ABC-1', { z: 'SM', y: 'Epic' }),
      tk('ABC-2', { z: 'SM', y: 'Program Epic' }),
      tk('ABC-3', { z: 'SM', s: 'Done' }),
      tk('ABC-4', { z: 'SM', s: 'In Progress', r: '2026-10-25T00:00:00Z' }),
      tk('ABC-5', { z: 'SM' }),
    ])
    expect(r.countable).toBe(1)
    expect(r.assigned).toBe(5)
  })

  it('a ticket with no resolved date but a Closed status is not open', () => {
    expect(load([tk('ABC-1', { z: 'SM', s: 'Done', r: null })]).countable).toBe(0)
  })

  it('counts only the assignee, never the pair', () => {
    const t = tk('ABC-1', { z: 'SM', a: 'Roe, Alex', pair: ['Doe, Jamie'] })
    expect(load([t], 'Doe, Jamie').countable).toBe(0)
    expect(load([t], 'Roe, Alex').assigned).toBe(5)
  })

  it('an unknown size label is unsized, and matching is exact', () => {
    const r = load([tk('ABC-1', { z: 'XXL' }), tk('ABC-2', { z: 'sm' }), tk('ABC-3', { z: 'SM' })])
    expect(r.unsized).toBe(2)
    expect(r.assigned).toBe(5)
  })

  it('an object prototype key is not a size', () => {
    expect(load([tk('ABC-1', { z: 'constructor' })]).unsized).toBe(1)
  })

  it('counts roster-paired tickets with no roster assignee as left out, once, in no other figure', () => {
    const tickets = [
      tk('ABC-1', { z: 'SM', a: 'Dev, Sam', pair: ['Doe, Jamie'] }),
      tk('ABC-2', { z: 'SM', a: null, pair: ['Roe, Alex'] }),
      tk('ABC-3', { z: 'SM', a: 'Dev, Sam', pair: ['Doe, Jamie'], y: 'Epic' }),
      tk('ABC-4', { z: 'SM', a: 'Dev, Sam', pair: ['Doe, Jamie'], s: 'Done' }),
    ]
    expect(leftOutCount(tickets, cfg, wl, ['Doe, Jamie', 'Roe, Alex'])).toBe(2)
    expect(load(tickets).countable).toBe(0)
  })
})

describe('queue order and edges', () => {
  it('in progress before queued, then rank, no rank last, ties by key', () => {
    const r = load([
      tk('ABC-9', { z: 'XS', s: 'To Do', rk: 'a' }),
      tk('ABC-8', { z: 'XS', rk: null }),
      tk('ABC-7', { z: 'XS', rk: 'b' }),
      tk('ABC-6', { z: 'XS', rk: 'a' }),
      tk('ABC-5', { z: 'XS', rk: 'a' }),
    ])
    expect(r.items.map((i) => i.k)).toEqual(['ABC-5', 'ABC-6', 'ABC-7', 'ABC-8', 'ABC-9'])
  })

  it('compares rank strings plainly, not by locale', () => {
    const r = load([tk('ABC-1', { z: 'XS', rk: '0|i00007:' }), tk('ABC-2', { z: 'XS', rk: '0|hzzzzz:' })])
    expect(r.items.map((i) => i.k)).toEqual(['ABC-2', 'ABC-1'])
  })

  it('a finish on the due day is not late; the day after is', () => {
    const one = (effortH, due) => projectQueue([{ key: 'ABC-1', effortH, due }], 80, TODAY).get('ABC-1')
    expect(one(50, '2026-10-30').late).toBe(false) // 0.5d fits in Fri Oct 30, which is the due day
    expect(day(one(50, '2026-10-30').finish)).toBe('2026-10-30')
    expect(one(100, '2026-10-30').late).toBe(true) // 1d needs Oct 30 and Mon Nov 2, the day after
    expect(day(one(100, '2026-10-30').finish)).toBe('2026-11-02')
    expect(one(100, '2026-11-02').late).toBe(false) // finishing on the due day is not late
    expect(one(100, null).late).toBe(false) // no due date, never late
  })

  it('starts on Monday when today is a weekend', () => {
    const sat = new Date(2026, 10, 7)
    const p = projectQueue([{ key: 'ABC-1', effortH: 50, due: null }], 80, sat)
    expect(day(p.get('ABC-1').start)).toBe('2026-11-09')
  })

  it('stays exact with a focus that is not a tenth (0.35 gives 35 hundredths a day)', () => {
    const s = settingsFor('Doe, Jamie', { ...wl, focus: 0.35 })
    expect(s.perDayH).toBe(35)
    const p = projectQueue([{ key: 'ABC-1', effortH: 175, due: null }], 35, TODAY) // 1.75d = exactly 5 days
    expect(day(p.get('ABC-1').finish)).toBe('2026-11-05')
  })

  it('per-person override of focus and daysPerWeek', () => {
    const w = { ...wl, overrides: { 'Doe, Jamie': { focus: 0.4 }, 'Roe, Alex': { daysPerWeek: 4 } } }
    expect(settingsFor('Doe, Jamie', w).weeklyDays).toBe(2)
    expect(settingsFor('Roe, Alex', w).weeklyDays).toBeCloseTo(3.2, 10)
  })
})

describe('zero and empty states', () => {
  it('no capacity beats everything', () => {
    const r = load([tk('ABC-1', { z: 'SM' })], 'Doe, Jamie', win4, { ...wl, focus: 0 })
    expect(r.state).toBe('nocap')
    expect(r.band).toBeNull()
    expect(r.clears).toBeNull()
  })

  it('no open tickets is "no open work" at 0%', () => {
    const r = load([])
    expect(r.state).toBe('noopen')
    expect(r.pctRounded).toBe(0)
  })

  it('only unsized tickets is "no sized work", never 0%', () => {
    const r = load([tk('ABC-1'), tk('ABC-2')])
    expect(r.state).toBe('nosized')
    expect(r.band).toBeNull()
    expect(r.unsized).toBe(2)
  })
})

describe('team totals', () => {
  const rows = () => [
    load([tk('ABC-1', { z: 'MED' })], 'Doe, Jamie'),
    load([tk('ABC-2', { z: 'LG', a: 'Roe, Alex' })], 'Roe, Alex'),
  ]

  it('sums assigned and capacity and counts people over capacity', () => {
    const t = teamLoad(rows())
    expect(t.assigned).toBe(30)
    expect(t.capacity).toBe(32)
    expect(t.pctRounded).toBe(94)
    expect(t.overCount).toBe(1) // 20d against 16d
    expect(t.peopleWithCapacity).toBe(2)
  })

  it('leaves a zero-capacity person out of the sums and the over count, but not out of coverage', () => {
    const r = rows()
    r.push(load([tk('ABC-3', { z: 'XL', a: 'Zed, Pat' }), tk('ABC-4', { a: 'Zed, Pat' })], 'Zed, Pat', win4, { ...wl, focus: 0 }))
    const t = teamLoad(r)
    expect(t.assigned).toBe(30)
    expect(t.capacity).toBe(32)
    expect(t.peopleWithCapacity).toBe(2)
    expect(t.overCount).toBe(1)
    expect(t.countable).toBe(4)
    expect(t.unsized).toBe(1)
  })

  it('flags mostly unsized work, and not when nothing is countable', () => {
    expect(teamLoad([load([tk('ABC-1'), tk('ABC-2'), tk('ABC-3', { z: 'SM' })])]).mostlyUnsized).toBe(true)
    expect(teamLoad([load([tk('ABC-1', { z: 'SM' })])]).mostlyUnsized).toBe(false)
    expect(teamLoad([load([])]).mostlyUnsized).toBe(false)
  })
})

describe('colour bands', () => {
  it('50, 51, 85, 86, 95, 96', () => {
    expect(bandFor(0)).toBe('under')
    expect(bandFor(50)).toBe('under')
    expect(bandFor(51)).toBe('healthy')
    expect(bandFor(85)).toBe('healthy')
    expect(bandFor(86)).toBe('near')
    expect(bandFor(95)).toBe('near')
    expect(bandFor(96)).toBe('full')
    expect(bandFor(188)).toBe('full')
  })

  it('bands use the rounded percentage', () => {
    expect(bandFor(50.4)).toBe('under')
    expect(bandFor(50.6)).toBe('healthy')
    expect(bandFor(95.4)).toBe('near')
    expect(bandFor(95.5)).toBe('full')
  })
})

describe('buildWorkload', () => {
  const data = (version, tickets = []) => ({ version, meta: { pulledAt: '2026-10-30T12:00:00Z' }, tickets })

  it('lists every roster member, including people with nothing open', () => {
    const r = buildWorkload({ data: data(4, [tk('ABC-1', { z: 'SM' })]), cfg, win: win4, today: TODAY })
    expect(r.status).toBe('ready')
    expect(r.rows.map((x) => x.name)).toEqual(['Doe, Jamie', 'Roe, Alex'])
    expect(r.rows[1].state).toBe('noopen')
  })

  it('asks for a refresh on a version 3 file', () => {
    expect(buildWorkload({ data: data(3), cfg, win: win4, today: TODAY }).status).toBe('needs-refresh')
  })

  it('reports not configured when the block is missing or wrong', () => {
    const none = buildWorkload({ data: data(4), cfg: { ...cfg, workload: undefined }, win: win4, today: TODAY })
    expect(none.status).toBe('not-configured')
    expect(none.absent).toBe(true)
    const bad = buildWorkload({ data: data(4), cfg: { ...cfg, workload: { ...cfg.workload, focus: 3 } }, win: win4, today: TODAY })
    expect(bad.status).toBe('not-configured')
    expect(bad.absent).toBe(false)
    expect(bad.reason).toMatch(/focus/)
  })
})
