import config from './config.js'
import { fiscalPosition } from './fiscal.js'

// A window is { start, end }: start is inclusive, end is exclusive, and end never goes past the
// last Jira pull because nothing newer was saved. Rolling presets ("last 7 days") count back from
// the pull so they match the data. Calendar presets (this week, period, quarter, fiscal year) are
// worked out from TODAY, so they roll over on their own; only the end is held back to the pull.

const DAY_MS = 864e5
const pad = (n) => String(n).padStart(2, '0')
const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtFull = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const weekStartOf = (d) => addDays(startOfDay(d), -d.getDay())
const isMidnight = (d) => d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0
/** The last calendar day a window covers (end is exclusive). */
const lastDay = (win) => startOfDay(new Date(win.end.getTime() - 1))

export const toIsoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 'YYYY-MM-DD' to a local midnight Date, or null if it is not a real calendar date. */
export function parseIsoDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null
}

function makePresets(pull, today) {
  const todayStart = startOfDay(today)
  const clamp = (d) => new Date(Math.min(d.getTime(), pull.getTime()))
  const list = [7, 14, 30].map((n) => ({
    id: `last${n}`,
    label: `Last ${n} days`,
    start: new Date(pull.getTime() - n * DAY_MS),
    end: pull,
    within: `in the last ${n} days`,
  }))

  const ws = weekStartOf(todayStart)
  list.push({ id: 'week', label: 'This week', start: ws, end: clamp(addDays(ws, 7)), within: 'so far this week' })
  const lw = addDays(ws, -7)
  list.push({ id: 'lastweek', label: 'Last full week', start: lw, end: clamp(ws), within: `in the week of ${fmtShort(lw)}` })

  const pos = fiscalPosition(todayStart)
  if (pos) {
    list.push({ id: 'period', label: `This period (P${pos.period})`, start: pos.periodStart, end: clamp(addDays(pos.periodEnd, 1)), within: `in this fiscal period (P${pos.period})` })
    const pp = fiscalPosition(addDays(pos.periodStart, -1))
    if (pp) list.push({ id: 'lastperiod', label: `Last period (P${pp.period})`, start: pp.periodStart, end: clamp(addDays(pp.periodEnd, 1)), within: `in the last fiscal period (P${pp.period})`, prev: 'period' })
    list.push({ id: 'quarter', label: `This quarter (Q${pos.quarter})`, start: pos.quarterStart, end: clamp(addDays(pos.quarterEnd, 1)), within: `in this fiscal quarter (Q${pos.quarter})` })
    const pq = fiscalPosition(addDays(pos.quarterStart, -1))
    if (pq) list.push({ id: 'lastquarter', label: `Last quarter (Q${pq.quarter})`, start: pq.quarterStart, end: clamp(addDays(pq.quarterEnd, 1)), within: `in the last fiscal quarter (Q${pq.quarter})`, prev: 'quarter' })
    list.push({ id: 'fytd', label: `Fiscal year to date (FY${pos.year})`, start: pos.yearStart, end: clamp(addDays(todayStart, 1)), within: `so far in fiscal year ${pos.year}` })
  }
  return list
}

export function buildPresets(pull, historyStart, today = pull) {
  return makePresets(pull, today).map((p) => {
    const tooEarly = p.start < historyStart
    const tooLate = p.start >= pull
    const reason = tooEarly
      ? `The saved data only goes back to ${fmtFull(historyStart)}.`
      : tooLate
        ? 'This range starts after the last refresh. Choose Refresh from Jira.'
        : undefined
    return { ...p, disabled: tooEarly || tooLate, reason }
  })
}

/** The window to compare against: the fiscal period or quarter before a "last" preset, else the same length just before. */
function comparisonFor(win, historyStart) {
  let start
  let end
  if (win.prev) {
    const p = fiscalPosition(addDays(win.start, -1))
    if (!p) return { ok: false, reason: 'The fiscal calendar has no earlier period.' }
    start = win.prev === 'period' ? p.periodStart : p.quarterStart
    end = addDays(win.prev === 'period' ? p.periodEnd : p.quarterEnd, 1)
  } else {
    end = win.start
    start = new Date(win.start.getTime() - (win.end.getTime() - win.start.getTime()))
    if (isMidnight(win.start)) start = startOfDay(new Date(start.getTime() + 12 * 3600e3)) // absorb a daylight-saving hour
  }
  if (start < historyStart) return { ok: false, reason: `The saved data only goes back to ${fmtFull(historyStart)}.` }
  const cmp = { ok: true, start, end }
  return { ...cmp, label: windowLabel(cmp), within: `from ${fmtShort(start)} to ${fmtShort(lastDay(cmp))}` }
}

/**
 * range: { id, since, until, compare } as chosen on the page. Returns the window to use, always valid.
 * An unknown or unavailable choice falls back to the first preset. today defaults to the pull.
 */
export function resolveWindow(range, pull, historyStart, today = pull) {
  const presets = buildPresets(pull, historyStart, today)
  // The earliest custom day is the first full local day after the history starts, because tickets
  // resolved earlier that day were not pulled.
  const min = addDays(startOfDay(historyStart), 1)
  const max = startOfDay(pull)

  let chosen
  let note = null
  if (range?.id === 'custom') {
    let start = parseIsoDay(range.since) ?? startOfDay(presets[0].start)
    if (start < min) { start = min; note = `The saved data starts ${fmtShort(min)}, so the range starts there.` }
    if (start > max) { start = max; note = `Latest start date is ${fmtShort(max)}.` }
    let until = parseIsoDay(range.until)
    let end = pull
    if (until) {
      if (until < start) { until = start; note = 'The end date cannot be before the start date, so it was moved to the start date.' }
      if (until > max) until = max
      end = new Date(Math.min(addDays(until, 1).getTime(), pull.getTime()))
    }
    chosen = { id: 'custom', label: 'Custom', start, end, within: until ? `from ${fmtShort(start)} to ${fmtShort(until)}` : `since ${fmtShort(start)}` }
  } else {
    chosen = presets.find((p) => p.id === range?.id && !p.disabled) ?? presets[0]
  }

  const compare = range?.compare === 'previous' ? comparisonFor(chosen, historyStart) : null
  return {
    ...chosen,
    note,
    presets,
    sinceDay: toIsoDay(chosen.start),
    untilDay: toIsoDay(lastDay(chosen)),
    minDay: toIsoDay(min),
    maxDay: toIsoDay(max),
    compareOption: comparisonFor(chosen, historyStart),
    compare,
    // The pull is older than today: newer activity is not in the saved data yet.
    stale: startOfDay(today) > startOfDay(pull),
  }
}

export const windowLabel = (win) => `${fmtShort(win.start)} to ${fmtFull(lastDay(win))}`

const KEY = 'dar.range'
export const defaultRange = () => ({ id: config.defaultRange, since: null, until: null, compare: 'off' })

export function loadRange() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    if (v && typeof v.id === 'string') {
      return {
        id: v.id,
        since: typeof v.since === 'string' ? v.since : null,
        until: typeof v.until === 'string' ? v.until : null,
        compare: v.compare === 'previous' ? 'previous' : 'off',
      }
    }
  } catch { /* storage unavailable or corrupt */ }
  return defaultRange()
}

export function saveRange(range) {
  try { localStorage.setItem(KEY, JSON.stringify(range)) } catch { /* ignore */ }
}
