import { bucketOf } from './report.js'
import { parseIsoDay } from './windows.js'
import { firstWorkDay, nextWorkDay } from './workWindow.js'
import { checkWorkloadConfig } from './workloadConfig.js'

// Workload: how much open, sized work each roster member has, against the days they have in a window.
// Pure functions; the page passes in the data, the config, the window and today.
//
// A ticket counts for a person when it is open (no resolved date and not in a Closed status), is not a
// container type (Epic), and the person is its ASSIGNEE and on the roster. Pair names add no load.
// Effort comes from the T-shirt size (config.workload.sizeDays). An unsized ticket adds 0 days but is
// counted and listed, so it never makes a person look free. Money-style care with floats: all day maths
// is done in integer hundredths of a day, because 0.8 a day added up in floating point drifts.

const H = 100
const toH = (days) => Math.round(days * H)

/** Colour band for a rounded percentage of capacity. */
export function bandFor(pct) {
  const p = Math.round(pct)
  if (p <= 50) return 'under'
  if (p <= 85) return 'healthy'
  if (p <= 95) return 'near'
  return 'full'
}

/** A person's days per week and focus, after any override. */
export function settingsFor(name, wl) {
  const o = wl.overrides?.[name] ?? {}
  const daysPerWeek = o.daysPerWeek ?? wl.daysPerWeek
  const focus = o.focus ?? wl.focus
  const weeklyDays = daysPerWeek * focus
  return { daysPerWeek, focus, weeklyDays, perDayH: Math.round((weeklyDays / 5) * H) }
}

/** 'prog' (in progress, in PM review or blocked), 'queued' (open) or null (closed). */
export function roleOf(ticket, cfg) {
  const b = bucketOf(ticket, cfg)
  if (b === 'closed') return null
  return b === 'open' ? 'queued' : 'prog'
}

const isOpen = (t, cfg) => t.r == null && roleOf(t, cfg) !== null

/** Days for a ticket's T-shirt size, or null when it has none or the label is not in sizeDays. */
export function sizeDaysFor(ticket, wl) {
  const z = ticket.z
  return typeof z === 'string' && Object.hasOwn(wl.sizeDays, z) ? wl.sizeDays[z] : null
}

const isCountable = (t, cfg, wl, roster) => isOpen(t, cfg) && !wl.excludedTypes.includes(t.y) && roster.has(t.a)

/** In progress first, then queued; within a group by rank string (plain comparison), no rank last, ties by key. */
function queueOrder(a, b) {
  if (a.role !== b.role) return a.role === 'prog' ? -1 : 1
  const ra = a.rk ?? null
  const rb = b.rk ?? null
  if (ra !== rb) {
    if (ra === null) return 1
    if (rb === null) return -1
    return ra < rb ? -1 : 1
  }
  return a.k < b.k ? -1 : a.k > b.k ? 1 : 0
}

/**
 * Lay items end to end, filling each work day up to perDayH hundredths of a day. items are already in order:
 * { key, effortH, due }. Returns Map key -> { start, finish, late }. Zero-effort items are skipped.
 */
export function projectQueue(items, perDayH, today) {
  const out = new Map()
  if (!(perDayH > 0)) return out
  let day = firstWorkDay(today)
  let avail = perDayH
  for (const it of items) {
    if (!(it.effortH > 0)) continue
    let need = it.effortH
    let start = null
    while (need > 0) {
      if (avail === 0) {
        day = nextWorkDay(day)
        avail = perDayH
      }
      const take = Math.min(need, avail)
      if (start === null) start = day
      avail -= take
      need -= take
    }
    const due = it.due ? parseIsoDay(it.due) : null
    out.set(it.key, { start, finish: day, late: !!due && day > due })
  }
  return out
}

/** One roster member. win is the resolved capacity window (needs workDays). */
export function personLoad(name, tickets, cfg, wl, win, today) {
  const s = settingsFor(name, wl)
  const roster = new Set([name])
  const mine = tickets
    .filter((t) => isCountable(t, cfg, wl, roster))
    .map((t) => {
      const days = sizeDaysFor(t, wl)
      return { k: t.k, t: t.t, s: t.s, rk: t.rk ?? null, due: t.d ?? null, role: roleOf(t, cfg), days, effortH: days === null ? 0 : toH(days) }
    })
    .sort(queueOrder)

  const sum = (role) => mine.filter((i) => i.role === role).reduce((a, i) => a + i.effortH, 0)
  const progH = sum('prog')
  const queuedH = sum('queued')
  const assignedH = progH + queuedH
  const capH = s.perDayH * win.workDays
  const unsized = mine.filter((i) => i.days === null)
  const sized = mine.length - unsized.length

  const plan = projectQueue(mine.map((i) => ({ key: i.k, effortH: i.effortH, due: i.due })), s.perDayH, today)
  const items = mine.map((i) => ({ ...i, ...(plan.get(i.k) ?? { start: null, finish: null, late: false }) }))
  const finishes = items.map((i) => i.finish).filter(Boolean)

  let state = 'ok'
  if (!(capH > 0)) state = 'nocap'
  else if (mine.length === 0) state = 'noopen'
  else if (sized === 0) state = 'nosized'

  const pct = capH > 0 ? (assignedH / capH) * 100 : 0
  return {
    name,
    ...s,
    state,
    countable: mine.length,
    sized,
    unsized: unsized.length,
    unsizedTickets: unsized.map(({ k, t, s: status }) => ({ k, t, s: status })),
    progDays: progH / H,
    queuedDays: queuedH / H,
    assigned: assignedH / H,
    capacity: capH / H,
    pct,
    pctRounded: Math.round(pct),
    band: state === 'ok' ? bandFor(pct) : null,
    free: capH > assignedH ? (capH - assignedH) / H : 0,
    over: assignedH > capH ? (assignedH - capH) / H : 0,
    weeksOfWork: s.weeklyDays > 0 ? assignedH / H / s.weeklyDays : null,
    late: items.filter((i) => i.late).length,
    clears: finishes.length ? finishes.reduce((a, b) => (b > a ? b : a)) : null,
    items,
  }
}

/**
 * Team totals. People with no capacity are left out of assigned, capacity and the over-capacity count
 * (so they cannot inflate the percentage); coverage and unsized counts include everyone.
 */
export function teamLoad(rows) {
  const withCap = rows.filter((r) => r.capacity > 0)
  const sumH = (key, list = withCap) => list.reduce((a, r) => a + toH(r[key]), 0)
  const assignedH = sumH('assigned')
  const capH = sumH('capacity')
  const pct = capH > 0 ? (assignedH / capH) * 100 : 0
  const countable = rows.reduce((a, r) => a + r.countable, 0)
  const sized = rows.reduce((a, r) => a + r.sized, 0)
  return {
    people: rows.length,
    peopleWithCapacity: withCap.length,
    assigned: assignedH / H,
    progDays: sumH('progDays') / H,
    queuedDays: sumH('queuedDays') / H,
    capacity: capH / H,
    pct,
    pctRounded: Math.round(pct),
    band: capH > 0 && assignedH > 0 ? bandFor(pct) : null,
    free: capH > assignedH ? (capH - assignedH) / H : 0,
    freePct: capH > 0 && capH > assignedH ? Math.round(((capH - assignedH) / capH) * 100) : 0,
    overCount: withCap.filter((r) => r.assigned > r.capacity).length,
    countable,
    sized,
    unsized: countable - sized,
    mostlyUnsized: countable > 0 && sized * 2 < countable,
  }
}

/** Open, non-container tickets that name a roster member in Pair but have no roster assignee. Counted in no other figure. */
export function leftOutCount(tickets, cfg, wl, rosterNames) {
  const roster = new Set(rosterNames)
  return tickets.filter(
    (t) => isOpen(t, cfg) && !wl.excludedTypes.includes(t.y) && !roster.has(t.a) && (t.pair ?? []).some((p) => roster.has(p)),
  ).length
}

/**
 * Everything the Workload page shows. status is 'ready', 'not-configured' (config block missing or wrong)
 * or 'needs-refresh' (data file is older than version 4, so it has no sizes).
 */
export function buildWorkload({ data, cfg, win, today }) {
  const names = cfg.roster.map((r) => r.jiraName)
  const chk = checkWorkloadConfig(cfg.workload)
  if (!chk.ok) return { status: 'not-configured', absent: chk.absent, reason: chk.reason }
  if (!(data?.version >= 4)) return { status: 'needs-refresh' }
  const wl = chk.value
  const rows = names.map((n) => personLoad(n, data.tickets, cfg, wl, win, today))
  return {
    status: 'ready',
    wl,
    rows,
    team: teamLoad(rows),
    leftOut: leftOutCount(data.tickets, cfg, wl, names),
    pulledAt: data.meta?.pulledAt ?? null,
  }
}
