import { startOfDay, addDays, parseIsoDay } from './windows.js'
import { currentQuarterKey, fiscalQuarters } from './fiscal.js'

// The Workload view's capacity window: the days ahead that open work is compared against.
// A window is a start day and an END day, both inclusive, as local midnights. The start is never
// before today, so "this week" and "this quarter" cover what is LEFT of them (a week is Sunday to Saturday,
// as in the fiscal calendar). They are worked out from today, so they roll over by themselves.
// A range that is entirely in the past is not available yet (a later build shows delivered work for
// those). Pure apart from the saved choice at the bottom.

export const WORK_PRESETS = [2, 4, 8, 12].map((n) => ({ id: `next${n}`, weeks: n, label: `Next ${n} weeks` }))
export const DEFAULT_CHOICE = { id: 'next4' }
const KEY = 'dar.workWindow'

export const isWorkDay = (d) => d.getDay() !== 0 && d.getDay() !== 6

/** Monday to Friday days from start to end, both inclusive. */
export function countWorkDays(start, end) {
  let n = 0
  for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) if (isWorkDay(d)) n++
  return n
}

/** Today if it is a work day, otherwise the next Monday. */
export function firstWorkDay(day) {
  let d = startOfDay(day)
  while (!isWorkDay(d)) d = addDays(d, 1)
  return d
}

export const nextWorkDay = (day) => firstWorkDay(addDays(startOfDay(day), 1))

/** The fiscal quarter that is `offset` quarters from the one containing today (0 = this, 1 = next), or null. */
function quarterAt(today, offset) {
  const key = currentQuarterKey(today)
  if (!key) return null
  const all = fiscalQuarters()
  return all[all.findIndex((q) => q.key === key) + offset] ?? null
}

const done = (id, label, start, end, extra = {}) => ({ ok: true, id, label, start, end, workDays: countWorkDays(start, end), clamped: false, ...extra })

/**
 * choice: { id: 'next2' | 'next4' | 'next8' | 'next12' | 'thisweek' | 'nextweek' | 'thisquarter' | 'nextquarter' | 'custom',
 *           since?, until? } (since and until are YYYY-MM-DD).
 * Returns { ok: true, id, label, start, end, workDays, clamped, assumed? } or { ok: false, past?, reason }.
 */
export function resolveWorkWindow(choice, today) {
  const t0 = startOfDay(today)
  const preset = WORK_PRESETS.find((p) => p.id === choice?.id)
  if (preset) return done(preset.id, preset.label, t0, addDays(t0, preset.weeks * 7 - 1))

  if (choice?.id === 'thisweek') {
    const w = done('thisweek', 'This week', t0, addDays(t0, 6 - t0.getDay()))
    return w.workDays > 0 ? w : { ok: false, reason: 'No work days are left this week. Choose Next week.' }
  }
  if (choice?.id === 'nextweek') {
    const start = addDays(t0, 7 - t0.getDay())
    return done('nextweek', 'Next week', start, addDays(start, 6))
  }
  if (choice?.id === 'thisquarter' || choice?.id === 'nextquarter') {
    const next = choice.id === 'nextquarter'
    const q = quarterAt(today, next ? 1 : 0)
    if (!q) return { ok: false, reason: next ? 'The fiscal calendar has no later quarter.' : 'The fiscal calendar does not cover today.' }
    const label = `${next ? 'Next' : 'This'} quarter (Q${q.quarter})`
    const w = done(choice.id, label, next ? q.start : t0, q.end, { assumed: q.assumed })
    return w.workDays > 0 ? w : { ok: false, reason: 'No work days are left this quarter. Choose Next quarter.' }
  }
  if (choice?.id === 'custom') {
    const since = parseIsoDay(choice.since)
    const until = parseIsoDay(choice.until)
    if (!since || !until || until < since) return { ok: false, reason: 'That date range is not valid.' }
    if (until < t0) return { ok: false, past: true, reason: 'Past ranges (delivered work) are not available yet.' }
    const clamped = since < t0
    const start = clamped ? t0 : since
    return { ok: true, id: 'custom', label: 'Custom range', start, end: until, workDays: countWorkDays(start, until), clamped }
  }
  return { ok: false, reason: 'Unknown capacity window.' }
}

/**
 * The choices for the dropdown, grouped like the Dashboard's date range. Each item is { id, label, disabled, reason, assumed }.
 * A choice that cannot be used today (no work days left this week, a fiscal calendar that has run out) is disabled with the reason.
 */
export function workWindowGroups(today) {
  const item = (id, fallback) => {
    const w = resolveWorkWindow({ id }, today)
    return { id, label: w.ok ? w.label : fallback, disabled: !w.ok, reason: w.ok ? undefined : w.reason, assumed: w.assumed ?? false }
  }
  return [
    { label: 'Rolling, from today', items: WORK_PRESETS.map((p) => item(p.id, p.label)) },
    { label: 'Calendar', items: [item('thisweek', 'This week'), item('nextweek', 'Next week')] },
    { label: 'Fiscal', items: [item('thisquarter', 'This quarter'), item('nextquarter', 'Next quarter')] },
  ]
}

/** The saved choice, or next 4 weeks if it is missing, malformed, unknown or has slipped into the past. */
export function loadWorkWindow(today = new Date()) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    if (v && typeof v === 'object' && resolveWorkWindow(v, today).ok) {
      return v.id === 'custom' ? { id: 'custom', since: v.since, until: v.until } : { id: v.id }
    }
  } catch { /* nothing saved, or storage is blocked */ }
  return { ...DEFAULT_CHOICE }
}

export function saveWorkWindow(choice) {
  try { localStorage.setItem(KEY, JSON.stringify(choice)) } catch { /* ignore */ }
}
