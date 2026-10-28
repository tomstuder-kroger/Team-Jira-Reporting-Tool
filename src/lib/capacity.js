import { quarterInfo, parseQuarterKey } from './fiscal.js'

// Planned capacity, after the sibling capacity-planning app's method: weeks per Kroger fiscal quarter.
//   available weeks = weeks in the quarter minus time off
//   a person's allocation is a % of their available time, split across portfolios
//   planned weeks   = available weeks x allocation %
//   status          = under below 90%, fully allocated 90 to 100%, over above 100%
// A total of 0% is shown as "not planned" rather than "under". Story points are not used.
// Nothing here calls Jira; the plan is typed in and saved by server/capacity.mjs.

export const THRESHOLDS = { fully: 90, over: 100 }
export const STATUS_LABEL = { none: 'Not planned', under: 'Under', fully: 'Fully allocated', over: 'Over' }
export const emptyCapacity = () => ({ portfolios: [], teams: [], people: {} })

const round2 = (n) => Math.round(n * 100) / 100
const round1 = (n) => Math.round(n * 10) / 10

export function statusFor(totalPct) {
  if (!(totalPct > 0)) return 'none'
  if (totalPct > THRESHOLDS.over) return 'over'
  if (totalPct >= THRESHOLDS.fully) return 'fully'
  return 'under'
}

/** A person can be on several teams. Reads the older single `team` value too. */
export const personTeams = (person) => (Array.isArray(person?.teams) ? person.teams : person?.team ? [person.team] : [])

/** One person for one quarter. portfolios is the current list; allocations to anything else are ignored. */
export function personCapacity(name, person, key, portfolios) {
  const info = parseQuarterKey(key) && quarterInfo(parseQuarterKey(key).year, parseQuarterKey(key).quarter)
  const quarterWeeks = info?.weeks ?? 0
  const timeOff = Number(person?.timeOff?.[key]) || 0
  const available = Math.max(0, round2(quarterWeeks - timeOff))
  const alloc = {}
  for (const p of portfolios) {
    const v = Number(person?.allocations?.[key]?.[p])
    if (v > 0) alloc[p] = v
  }
  const total = Object.values(alloc).reduce((a, b) => a + b, 0)
  const weeks = Object.fromEntries(Object.entries(alloc).map(([p, v]) => [p, round2((available * v) / 100)]))
  return {
    name,
    teams: personTeams(person),
    quarterWeeks,
    timeOff,
    available,
    alloc,
    weeks,
    total,
    planned: round2((available * total) / 100),
    unallocated: Math.max(0, 100 - total),
    over: Math.max(0, total - 100),
    status: statusFor(total),
  }
}

/** Rows for every name, in the order given. */
export const capacityRows = (names, cap, key) => names.map((n) => personCapacity(n, cap.people?.[n], key, cap.portfolios))

/**
 * Team-wide totals, per portfolio and per team. Utilization is weighted by available weeks.
 * A person on several teams is counted in full under each of them, so the team rows do not add up to
 * the team-wide total. People on no team are grouped under ''.
 */
export function summarize(rows, portfolios, teams) {
  const available = round2(rows.reduce((a, r) => a + r.available, 0))
  const planned = round2(rows.reduce((a, r) => a + r.planned, 0))
  const util = (p, a) => (a > 0 ? round1((p / a) * 100) : 0)
  const perPortfolio = portfolios.map((p) => ({ portfolio: p, weeks: round2(rows.reduce((a, r) => a + (r.weeks[p] ?? 0), 0)) }))
  const groups = [...teams, ''].map((team) => {
    const members = rows.filter((r) => (team === '' ? r.teams.length === 0 : r.teams.includes(team)))
    const a = round2(members.reduce((x, r) => x + r.available, 0))
    const pl = round2(members.reduce((x, r) => x + r.planned, 0))
    return { team, people: members.length, available: a, planned: pl, utilization: util(pl, a) }
  }).filter((g) => g.people > 0)
  return {
    people: rows.length,
    available,
    planned,
    unallocatedWeeks: round2(Math.max(0, available - planned)),
    utilization: util(planned, available),
    over: rows.filter((r) => r.status === 'over').length,
    unplanned: rows.filter((r) => r.status === 'none').length,
    perPortfolio,
    perTeam: groups,
  }
}

// ---- Edits. Each returns a new object and leaves the input alone. ----

const clone = (cap) => JSON.parse(JSON.stringify(cap))
const person = (cap, name) => (cap.people[name] ??= {})

/** Puts a person on a team or takes them off it. A person can be on several teams. */
export function setTeamMember(cap, name, team, on) {
  const next = clone(cap)
  const p = person(next, name)
  const current = personTeams(p)
  const teams = on ? [...new Set([...current, team])] : current.filter((t) => t !== team)
  delete p.team // the older single-team value is replaced by the list
  if (teams.length) p.teams = teams
  else delete p.teams
  return next
}

export function setTimeOff(cap, name, key, weeks) {
  const next = clone(cap)
  const p = person(next, name)
  p.timeOff ??= {}
  if (weeks > 0) p.timeOff[key] = weeks
  else delete p.timeOff[key]
  return next
}

/** pct is a number; 0 or less removes the entry. Values are kept as whole numbers from 0 to 100. */
export function setPercent(cap, name, key, portfolio, pct) {
  const next = clone(cap)
  const p = person(next, name)
  p.allocations ??= {}
  p.allocations[key] ??= {}
  const v = Math.min(100, Math.max(0, Math.round(Number(pct) || 0)))
  if (v > 0) p.allocations[key][portfolio] = v
  else delete p.allocations[key][portfolio]
  return next
}

/** Checks a new or renamed label against the existing ones. Returns { ok, name } or { ok: false, error }. */
export function checkLabel(raw, existing, { keep = null } = {}) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return { ok: false, error: 'Enter a name.' }
  if (name.length > 60) return { ok: false, error: 'That name is too long (60 characters at most).' }
  if (/["\\]/.test(name)) return { ok: false, error: 'Quotation marks and backslashes are not allowed.' }
  if (existing.some((e) => e !== keep && e.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} already exists.` }
  return { ok: true, name }
}

export function addLabel(cap, list, name) {
  const next = clone(cap)
  next[list] = [...next[list], name]
  return next
}

/** Renames a portfolio or team everywhere it is used. */
export function renameLabel(cap, list, from, to) {
  const next = clone(cap)
  next[list] = next[list].map((x) => (x === from ? to : x))
  for (const p of Object.values(next.people)) {
    if (list === 'teams') p.teams = personTeams(p).map((t) => (t === from ? to : t)).filter((t, i, a) => a.indexOf(t) === i)
    if (list === 'portfolios') {
      for (const alloc of Object.values(p.allocations ?? {})) {
        if (from in alloc) { alloc[to] = alloc[from]; delete alloc[from] }
      }
    }
  }
  tidyTeams(next)
  return next
}

/** Removes a portfolio (and every percentage on it) or a team (people on it become unassigned). */
export function removeLabel(cap, list, name) {
  const next = clone(cap)
  next[list] = next[list].filter((x) => x !== name)
  for (const p of Object.values(next.people)) {
    if (list === 'teams') p.teams = personTeams(p).filter((t) => t !== name)
    if (list === 'portfolios') for (const alloc of Object.values(p.allocations ?? {})) delete alloc[name]
  }
  tidyTeams(next)
  return next
}

function tidyTeams(cap) {
  for (const p of Object.values(cap.people)) {
    delete p.team
    if (Array.isArray(p.teams) && p.teams.length === 0) delete p.teams
  }
}
