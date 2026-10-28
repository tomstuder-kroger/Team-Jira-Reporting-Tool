import { describe, it, expect } from 'vitest'
import cfgExample from '../../config/report.config.example.json'
import { buildWeeks } from './weeks.js'
import { spellsFor, blockedOverTime, daysBlocked } from './blocked.js'

// Synthetic data only. Local-time dates, so the tests hold in any time zone.
// Pull is Wed Nov 4 2026 12:00. Weeks start Sun Oct 18, Oct 25 and Nov 1.
const cfg = cfgExample
const [R0, R1] = cfg.roster.map((r) => r.jiraName)
const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).toISOString()
const meta = { pulledAt: at(11, 4), historyDays: 120, historyStart: at(7, 7), source: 'example.atlassian.net' }
const PULL = new Date(meta.pulledAt).getTime()
const T = (k, h, over = {}) => ({ k, t: `title ${k}`, s: 'Open', a: R0, pair: [], c: at(10, 1), u: at(10, 1), r: null, h, ...over })
const ch = (m, d, from, to) => [at(m, d), from, to]
const DAY = 864e5

describe('spellsFor', () => {
  it('blocked then unblocked is one finished spell', () => {
    const s = spellsFor(T('EX-1', [ch(10, 20, 'In Progress', 'Blocked'), ch(10, 23, 'Blocked', 'In Progress')]), PULL, cfg)
    expect(s).toEqual([{ start: new Date(at(10, 20)).getTime(), end: new Date(at(10, 23)).getTime(), open: false }])
  })

  it('still blocked stays open until the pull', () => {
    const s = spellsFor(T('EX-1', [ch(10, 30, 'In Progress', 'Blocked')], { s: 'Blocked' }), PULL, cfg)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ open: true, end: PULL })
  })

  it('a first change that leaves Blocked means it was blocked since it was created', () => {
    const s = spellsFor(T('EX-1', [ch(10, 5, 'Blocked', 'In Progress')]), PULL, cfg)
    expect(s).toEqual([{ start: new Date(at(10, 1)).getTime(), end: new Date(at(10, 5)).getTime(), open: false }])
  })

  it('a ticket resolved while blocked ends its spell at the resolved time', () => {
    const s = spellsFor(T('EX-1', [ch(10, 20, 'In Progress', 'Blocked')], { s: 'Closed', r: at(10, 24) }), PULL, cfg)
    expect(s).toEqual([{ start: new Date(at(10, 20)).getTime(), end: new Date(at(10, 24)).getTime(), open: false }])
  })

  it('two blocks on one ticket are two spells', () => {
    const s = spellsFor(T('EX-1', [
      ch(10, 10, 'Open', 'Blocked'), ch(10, 12, 'Blocked', 'In Progress'),
      ch(10, 20, 'In Progress', 'Blocked'), ch(10, 22, 'Blocked', 'In Progress'),
    ]), PULL, cfg)
    expect(s).toHaveLength(2)
  })

  it('a ticket that was never blocked, or has no history, has no spells', () => {
    expect(spellsFor(T('EX-1', [ch(10, 5, 'Open', 'In Progress')]), PULL, cfg)).toEqual([])
    expect(spellsFor(T('EX-2', undefined), PULL, cfg)).toEqual([])
  })
})

describe('daysBlocked', () => {
  it('counts whole days in the open spell, and is null otherwise', () => {
    const t = T('EX-1', [ch(10, 30, 'In Progress', 'Blocked')], { s: 'Blocked' })
    expect(daysBlocked(t, PULL, cfg)).toBe(5) // Oct 30 noon to Nov 4 noon
    expect(daysBlocked(T('EX-2', [ch(10, 30, 'In Progress', 'Blocked'), ch(11, 1, 'Blocked', 'Open')]), PULL, cfg)).toBeNull()
  })
})

describe('blockedOverTime', () => {
  const run = (tickets, span = '4') => blockedOverTime(buildWeeks({ version: 3, meta, tickets }, span, cfg), cfg)
  const wk = (r, label) => r.weeks.find((w) => w.label === label)

  it('counts newly blocked in the week the spell started, and blocked at the end of each week it covered', () => {
    // blocked Tue Oct 20 (week of Oct 18), unblocked Mon Nov 2 (week of Nov 1)
    const r = run([T('EX-1', [ch(10, 20, 'In Progress', 'Blocked'), ch(11, 2, 'Blocked', 'In Progress')])])
    expect(wk(r, 'Oct 18').newlyBlocked).toBe(1)
    expect(wk(r, 'Oct 25').newlyBlocked).toBe(0)
    expect([wk(r, 'Oct 18').blockedAtEnd, wk(r, 'Oct 25').blockedAtEnd, wk(r, 'Nov 1').blockedAtEnd]).toEqual([1, 1, 0])
    expect(wk(r, 'Oct 11').blockedAtEnd).toBe(0)
  })

  it('splits Saturday night from Sunday morning at the week boundary', () => {
    const sat = new Date(2026, 9, 31, 23, 59).toISOString()
    const sun = new Date(2026, 10, 1, 0, 0).toISOString()
    const r = run([T('EX-1', [[sat, 'Open', 'Blocked']]), T('EX-2', [[sun, 'Open', 'Blocked']])])
    expect(wk(r, 'Oct 25').newlyBlocked).toBe(1)
    expect(wk(r, 'Nov 1').newlyBlocked).toBe(1)
  })

  it('treats a still-blocked ticket as blocked at the end of the week in progress, and reports the headline numbers', () => {
    const r = run([T('EX-1', [ch(10, 30, 'In Progress', 'Blocked')], { s: 'Blocked' })])
    expect(wk(r, 'Nov 1').blockedAtEnd).toBe(1)
    expect(r.currentCount).toBe(1)
    expect(r.longestCurrentDays).toBe(5)
  })

  it('takes the median days over spells that finished inside the weeks shown', () => {
    const r = run([
      T('EX-1', [ch(10, 20, 'Open', 'Blocked'), ch(10, 22, 'Blocked', 'Open')]), // 2 days
      T('EX-2', [ch(10, 20, 'Open', 'Blocked'), ch(10, 27, 'Blocked', 'Open')]), // 7 days
      T('EX-3', [ch(10, 20, 'Open', 'Blocked'), ch(10, 21, 'Blocked', 'Open')]), // 1 day
    ])
    expect(r.medianDays).toBe(2)
    expect(r.finishedCount).toBe(3)
  })

  it('ignores tickets that are not on the roster, and gives nulls and zeros, not NaN, for no history', () => {
    const r = run([T('EX-1', [ch(10, 30, 'In Progress', 'Blocked')], { a: 'Dev, Dee' }), T('EX-2', [])])
    expect(r.currentCount).toBe(0)
    expect(r.medianDays).toBeNull()
    expect(r.longestCurrentDays).toBeNull()
    expect(r.weeks.every((w) => w.newlyBlocked === 0 && w.blockedAtEnd === 0)).toBe(true)
  })

  it('counts a ticket once per week even if it was blocked twice', () => {
    const r = run([T('EX-1', [ch(10, 20, 'Open', 'Blocked'), ch(10, 21, 'Blocked', 'Open'), ch(10, 22, 'Open', 'Blocked')], { s: 'Blocked' })])
    expect(wk(r, 'Oct 18').newlyBlocked).toBe(2)
    expect(wk(r, 'Oct 18').blockedAtEnd).toBe(1)
  })
})
