import { describe, it, expect } from 'vitest'
import { quarterInfo, quarterKey, parseQuarterKey, fiscalQuarters, currentQuarterKey } from './fiscal.js'
import { statusFor, personCapacity, capacityRows, summarize, personTeams, setTeamMember, setTimeOff, setPercent, checkLabel, addLabel, renameLabel, removeLabel, emptyCapacity } from './capacity.js'

// Synthetic only. FY2026 quarters are 16, 12, 12 and 12 weeks (checked against the printed calendar).
const PF = ['Portfolio A', 'Portfolio B']
const Q = 'FY2026-Q4' // 12 weeks, Nov 8 2026 to Jan 30 2027
const cap = (people) => ({ portfolios: PF, teams: ['Team One', 'Team Two'], people })

describe('fiscal quarters by key', () => {
  it('knows each FY2026 quarter length, start and end', () => {
    expect([1, 2, 3, 4].map((q) => quarterInfo(2026, q).weeks)).toEqual([16, 12, 12, 12])
    const q4 = quarterInfo(2026, 4)
    expect([q4.start.getMonth(), q4.start.getDate(), q4.end.getMonth(), q4.end.getDate(), q4.end.getFullYear()]).toEqual([10, 8, 0, 30, 2027])
    expect(q4.key).toBe('FY2026-Q4')
  })
  it('marks FY2027 as assumed and FY2026 as checked', () => {
    expect(quarterInfo(2026, 2).assumed).toBe(false)
    expect(quarterInfo(2027, 1).assumed).toBe(true)
  })
  it('returns null outside the known years or for a bad quarter', () => {
    expect(quarterInfo(2025, 1)).toBeNull()
    expect(quarterInfo(2028, 1)).toBeNull()
    expect(quarterInfo(2026, 5)).toBeNull()
    expect(quarterInfo(2026, 0)).toBeNull()
  })
  it('parses and builds keys, lists the quarters in order, and finds the quarter for a date', () => {
    expect(quarterKey(2026, 3)).toBe('FY2026-Q3')
    expect(parseQuarterKey('FY2026-Q3')).toEqual({ year: 2026, quarter: 3 })
    for (const bad of ['FY26-Q3', 'FY2026-Q5', 'fy2026-q3', '', null, undefined]) expect(parseQuarterKey(bad)).toBeNull()
    expect(fiscalQuarters().map((q) => q.key)).toEqual(['FY2026-Q1', 'FY2026-Q2', 'FY2026-Q3', 'FY2026-Q4', 'FY2027-Q1', 'FY2027-Q2', 'FY2027-Q3', 'FY2027-Q4'])
    expect(currentQuarterKey(new Date(2026, 9, 28))).toBe('FY2026-Q3')
    expect(currentQuarterKey(new Date(2026, 10, 8))).toBe('FY2026-Q4')
    expect(currentQuarterKey(new Date(2030, 0, 1))).toBeNull()
  })
})

describe('statusFor', () => {
  it('uses under below 90, fully allocated from 90 to 100, over above 100, and not planned at 0', () => {
    expect(statusFor(0)).toBe('none')
    expect(statusFor(89)).toBe('under')
    expect(statusFor(89.9)).toBe('under')
    expect(statusFor(90)).toBe('fully')
    expect(statusFor(100)).toBe('fully')
    expect(statusFor(101)).toBe('over')
    expect(statusFor(NaN)).toBe('none')
    expect(statusFor(undefined)).toBe('none')
  })
})

describe('personCapacity', () => {
  const person = { teams: ['Team One'], timeOff: { [Q]: 2 }, allocations: { [Q]: { 'Portfolio A': 60, 'Portfolio B': 30 } } }

  it('takes time off from the quarter weeks and splits the available weeks by percent', () => {
    const c = personCapacity('Doe, Jamie', person, Q, PF)
    expect([c.quarterWeeks, c.timeOff, c.available]).toEqual([12, 2, 10])
    expect(c.weeks).toEqual({ 'Portfolio A': 6, 'Portfolio B': 3 })
    expect([c.total, c.planned, c.unallocated, c.over, c.status]).toEqual([90, 9, 10, 0, 'fully'])
    expect(c.teams).toEqual(['Team One'])
  })

  it('flags over 100 with the amount, and keeps the weeks above the available', () => {
    const c = personCapacity('X', { allocations: { [Q]: { 'Portfolio A': 70, 'Portfolio B': 50 } } }, Q, PF)
    expect([c.total, c.over, c.unallocated, c.status, c.planned]).toEqual([120, 20, 0, 'over', 14.4])
  })

  it('never goes below zero available, however much time off', () => {
    const c = personCapacity('X', { timeOff: { [Q]: 15 }, allocations: { [Q]: { 'Portfolio A': 50 } } }, Q, PF)
    expect([c.available, c.planned, c.weeks['Portfolio A']]).toEqual([0, 0, 0])
  })

  it('treats a person with nothing entered, or an unknown quarter, as zeros not NaN', () => {
    for (const c of [personCapacity('X', undefined, Q, PF), personCapacity('X', {}, 'FY2030-Q1', PF), personCapacity('X', person, 'banana', PF)]) {
      expect(Object.values(c).filter((v) => typeof v === 'number').every(Number.isFinite)).toBe(true)
    }
    expect(personCapacity('X', undefined, Q, PF)).toMatchObject({ available: 12, total: 0, status: 'none', unallocated: 100 })
    expect(personCapacity('X', person, 'FY2030-Q1', PF).available).toBe(0)
  })

  it('ignores a percentage on a portfolio that is no longer listed, and other quarters', () => {
    const c = personCapacity('X', { allocations: { [Q]: { Gone: 80, 'Portfolio A': 20 }, 'FY2026-Q3': { 'Portfolio A': 100 } } }, Q, PF)
    expect(c.total).toBe(20)
  })

  it('uses the quarter length: the same plan gives more weeks in a 16-week quarter', () => {
    const p = { allocations: { 'FY2026-Q1': { 'Portfolio A': 50 }, [Q]: { 'Portfolio A': 50 } } }
    expect(personCapacity('X', p, 'FY2026-Q1', PF).weeks['Portfolio A']).toBe(8)
    expect(personCapacity('X', p, Q, PF).weeks['Portfolio A']).toBe(6)
  })
})

describe('summarize', () => {
  const people = {
    'A, Ann': { teams: ['Team One'], allocations: { [Q]: { 'Portfolio A': 100 } } },
    'B, Bo': { teams: ['Team One'], timeOff: { [Q]: 2 }, allocations: { [Q]: { 'Portfolio A': 50, 'Portfolio B': 70 } } },
    'C, Cy': { teams: ['Team Two'] },
    'D, Di': {},
  }
  const names = Object.keys(people)
  const rows = capacityRows(names, cap(people), Q)
  const s = summarize(rows, PF, ['Team One', 'Team Two'])

  it('rolls up weeks and utilization, weighted by available weeks', () => {
    expect([s.people, s.available, s.planned, s.utilization]).toEqual([4, 46, 12 + 12, 52.2]) // planned: Ann 12, Bo 12 (10 x 120%), others 0
    expect(s.unallocatedWeeks).toBe(22)
    expect([s.over, s.unplanned]).toEqual([1, 2])
  })
  it('rolls up planned weeks per portfolio and per team, with unassigned people as their own group', () => {
    expect(s.perPortfolio).toEqual([{ portfolio: 'Portfolio A', weeks: 17 }, { portfolio: 'Portfolio B', weeks: 7 }])
    expect(s.perTeam.map((g) => [g.team, g.people, g.available, g.planned])).toEqual([['Team One', 2, 22, 24], ['Team Two', 1, 12, 0], ['', 1, 12, 0]])
  })
  it('gives zeros not NaN for an empty roster', () => {
    const e = summarize([], PF, [])
    expect([e.available, e.planned, e.utilization, e.over]).toEqual([0, 0, 0, 0])
    expect(e.perPortfolio.every((p) => p.weeks === 0)).toBe(true)
  })
})

describe('edits', () => {
  const base = cap({ 'A, Ann': { teams: ['Team One'], allocations: { [Q]: { 'Portfolio A': 40 } } } })

  it('change a copy and leave the original alone', () => {
    const copy = JSON.stringify(base)
    setPercent(base, 'A, Ann', Q, 'Portfolio B', 30)
    setTeamMember(base, 'A, Ann', 'Team Two', true)
    setTimeOff(base, 'A, Ann', Q, 3)
    expect(JSON.stringify(base)).toBe(copy)
  })
  it('set a percent as a whole number from 0 to 100 and remove it at 0', () => {
    expect(setPercent(base, 'A, Ann', Q, 'Portfolio B', 30).people['A, Ann'].allocations[Q]).toEqual({ 'Portfolio A': 40, 'Portfolio B': 30 })
    expect(setPercent(base, 'A, Ann', Q, 'Portfolio A', 250).people['A, Ann'].allocations[Q]['Portfolio A']).toBe(100)
    expect(setPercent(base, 'A, Ann', Q, 'Portfolio A', 33.6).people['A, Ann'].allocations[Q]['Portfolio A']).toBe(34)
    expect(setPercent(base, 'A, Ann', Q, 'Portfolio A', 0).people['A, Ann'].allocations[Q]).toEqual({})
    expect(setPercent(base, 'A, Ann', Q, 'Portfolio A', 'abc').people['A, Ann'].allocations[Q]).toEqual({})
    expect(setPercent(base, 'A, Ann', Q, 'Portfolio A', -5).people['A, Ann'].allocations[Q]).toEqual({})
  })
  it('create a person entry when needed, and set team and time off', () => {
    expect(setTeamMember(base, 'New, Nia', 'Team Two', true).people['New, Nia'].teams).toEqual(['Team Two'])
    expect(setTimeOff(base, 'A, Ann', Q, 2.5).people['A, Ann'].timeOff[Q]).toBe(2.5)
    expect(setTimeOff(setTimeOff(base, 'A, Ann', Q, 2), 'A, Ann', Q, 0).people['A, Ann'].timeOff).toEqual({})
  })
  it('check labels: trimmed, no duplicates in any letter case, no quotes, not blank, not long', () => {
    expect(checkLabel('  New   one ', PF)).toEqual({ ok: true, name: 'New one' })
    expect(checkLabel('portfolio a', PF).ok).toBe(false)
    expect(checkLabel('Portfolio A', PF, { keep: 'Portfolio A' }).ok).toBe(true) // renaming to itself
    expect(checkLabel('   ', PF).ok).toBe(false)
    expect(checkLabel('Bad"Name', PF).ok).toBe(false)
    expect(checkLabel('x'.repeat(61), PF).ok).toBe(false)
  })
  it('rename a portfolio or team everywhere, and remove one without leaving a trace', () => {
    const c = cap({ 'A, Ann': { teams: ['Team One'], allocations: { [Q]: { 'Portfolio A': 40 }, 'FY2026-Q3': { 'Portfolio A': 20 } } } })
    const renamed = renameLabel(c, 'portfolios', 'Portfolio A', 'Alpha')
    expect(renamed.portfolios).toEqual(['Alpha', 'Portfolio B'])
    expect(renamed.people['A, Ann'].allocations).toEqual({ [Q]: { Alpha: 40 }, 'FY2026-Q3': { Alpha: 20 } })
    expect(renameLabel(c, 'teams', 'Team One', 'Uno').people['A, Ann'].teams).toEqual(['Uno'])
    expect(removeLabel(c, 'portfolios', 'Portfolio A').people['A, Ann'].allocations).toEqual({ [Q]: {}, 'FY2026-Q3': {} })
    expect(removeLabel(c, 'teams', 'Team One').people['A, Ann'].teams).toBeUndefined()
    expect(addLabel(emptyCapacity(), 'teams', 'T').teams).toEqual(['T'])
  })
})

describe('people on several teams and several portfolios', () => {
  const multi = cap({
    'A, Ann': { teams: ['Team One', 'Team Two'], allocations: { [Q]: { 'Portfolio A': 50, 'Portfolio B': 50 } } },
    'B, Bo': { teams: ['Team One'], allocations: { [Q]: { 'Portfolio A': 100 } } },
  })
  const rows = capacityRows(['A, Ann', 'B, Bo'], multi, Q)
  const s = summarize(rows, PF, ['Team One', 'Team Two'])

  it('splits one person across portfolios, and counts them in full under each of their teams', () => {
    expect(rows[0]).toMatchObject({ teams: ['Team One', 'Team Two'], weeks: { 'Portfolio A': 6, 'Portfolio B': 6 }, total: 100 })
    expect(s.perTeam.map((g) => [g.team, g.people, g.planned])).toEqual([['Team One', 2, 24], ['Team Two', 1, 12]])
  })
  it('keeps the team-wide total counted once, so team rows add up to more than it', () => {
    expect([s.people, s.planned]).toEqual([2, 24])
    expect(s.perTeam.reduce((a, g) => a + g.planned, 0)).toBeGreaterThan(s.planned)
  })
  it('puts someone on a team or takes them off, without duplicates, and tidies an empty list', () => {
    const on = setTeamMember(multi, 'B, Bo', 'Team Two', true)
    expect(on.people['B, Bo'].teams).toEqual(['Team One', 'Team Two'])
    expect(setTeamMember(on, 'B, Bo', 'Team Two', true).people['B, Bo'].teams).toEqual(['Team One', 'Team Two'])
    expect(setTeamMember(multi, 'B, Bo', 'Team One', false).people['B, Bo'].teams).toBeUndefined()
    expect(setTeamMember(multi, 'A, Ann', 'Team One', false).people['A, Ann'].teams).toEqual(['Team Two'])
  })
  it('reads the older single team value as a list of one, and replaces it when edited', () => {
    expect(personTeams({ team: 'Team One' })).toEqual(['Team One'])
    expect(personTeams({ teams: ['A', 'B'], team: 'C' })).toEqual(['A', 'B'])
    expect(personTeams(undefined)).toEqual([])
    const old = cap({ 'A, Ann': { team: 'Team One' } })
    expect(personCapacity('A, Ann', old.people['A, Ann'], Q, PF).teams).toEqual(['Team One'])
    const edited = setTeamMember(old, 'A, Ann', 'Team Two', true).people['A, Ann']
    expect(edited.teams).toEqual(['Team One', 'Team Two'])
    expect('team' in edited).toBe(false)
  })
  it('renames a team in everyone who is on it, without making duplicates, and removes it from all', () => {
    const r = renameLabel(multi, 'teams', 'Team Two', 'Team One') // merging into an existing name
    expect(r.people['A, Ann'].teams).toEqual(['Team One'])
    expect(removeLabel(multi, 'teams', 'Team One').people['A, Ann'].teams).toEqual(['Team Two'])
    expect(removeLabel(multi, 'teams', 'Team One').people['B, Bo'].teams).toBeUndefined()
  })
})
