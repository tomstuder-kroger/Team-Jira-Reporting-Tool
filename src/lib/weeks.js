import config from './config.js'
import { bucketOf } from './report.js'

// Weekly counts for the reports page. Weeks run Sunday to Saturday on local midnights, like the
// fiscal calendar. Everything is computed from the saved timestamps, so nothing here calls Jira.
//
// The saved data holds every roster ticket that was open or resolved in the last historyDays, so
// "opened" and "closed" are exact for any week that starts after the history does. Earlier weeks
// are left out because tickets resolved then were never pulled.

const DAY_MS = 864e5
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export const weekStart = (d) => addDays(d, -d.getDay())

export const SPANS = ['4', '8', '12', 'all']
const KEY = 'dar.weeks'
export const defaultSpan = () => '8'

export function loadSpan() {
  try {
    const v = localStorage.getItem(KEY)
    if (SPANS.includes(v)) return v
  } catch { /* storage unavailable */ }
  return defaultSpan()
}

export function saveSpan(span) {
  try { localStorage.setItem(KEY, span) } catch { /* ignore */ }
}

const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * span: '4' | '8' | '12' | 'all', the number of complete weeks to show (the week in progress is
 * always added). Returns the weeks, the roster tickets, and how many complete weeks exist.
 */
export function buildWeeks(data, span = defaultSpan(), cfg = config) {
  const anchor = new Date(data.meta.pulledAt)
  const earliest = addDays(startOfDay(new Date(data.meta.historyStart)), 1)
  const names = cfg.roster.map((r) => r.jiraName)
  const inRoster = (n) => names.includes(n)
  const tickets = data.tickets.filter((t) => inRoster(t.a) || t.pair.some(inRoster))

  const starts = []
  for (let s = weekStart(anchor); s >= earliest; s = addDays(s, -7)) starts.unshift(s)
  const all = starts.map((start) => ({ start, end: addDays(start, 7) }))
  const completeAvailable = all.filter((w) => w.end <= anchor).length
  const picked = span === 'all' ? all : all.slice(-(Number(span) + all.filter((w) => w.end > anchor).length))

  const weeks = picked.map((w) => {
    const startMs = w.start.getTime()
    const endMs = w.end.getTime()
    const inWeek = (iso) => {
      if (!iso) return false
      const ms = new Date(iso).getTime()
      return ms >= startMs && ms < endMs
    }
    const opened = tickets.filter((t) => inWeek(t.c)).length
    const closed = tickets.filter((t) => inWeek(t.r)).length
    const partial = w.end > anchor
    return {
      start: w.start,
      end: partial ? anchor : w.end,
      label: fmtShort(w.start),
      opened,
      closed,
      net: opened - closed,
      partial,
    }
  })

  return { weeks, tickets, anchor, from: weeks[0]?.start ?? null, available: completeAvailable }
}

const resolvedInSpan = (span) =>
  span.from ? span.tickets.filter((t) => t.r && new Date(t.r) >= span.from && new Date(t.r) <= span.anchor) : []

const median = (nums) => {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Velocity from ticket counts only. Complete weeks only, so a part-week never drags the average down. */
export function velocity(span) {
  const done = span.weeks.filter((w) => !w.partial)
  const recent = done.slice(-4)
  const counts = done.map((w) => w.closed)
  const days = resolvedInSpan(span)
    .map((t) => (new Date(t.r) - new Date(t.c)) / DAY_MS)
    .filter((n) => n >= 0)
  const med = median(days)
  return {
    average: recent.length ? recent.reduce((a, w) => a + w.closed, 0) / recent.length : null,
    averageWeeks: recent.length,
    best: counts.length ? Math.max(...counts) : null,
    low: counts.length ? Math.min(...counts) : null,
    medianDays: med === null ? null : Math.round(med * 10) / 10,
    closedCount: days.length,
  }
}

const OPEN_ORDER = ['blocked', 'review', 'prog', 'open']

/** Open tickets right now by status bucket. A snapshot of the last pull, so it ignores the week span. */
export function openByStatus(data, cfg = config) {
  const names = cfg.roster.map((r) => r.jiraName)
  const open = data.tickets.filter((t) => !t.r && (names.includes(t.a) || t.pair.some((p) => names.includes(p))))
  const slices = OPEN_ORDER.map((bucket) => ({ bucket, count: open.filter((t) => bucketOf(t, cfg) === bucket).length }))
  return { slices, total: open.length }
}

/** Tickets resolved in the span, per designer: assigned to them, and paired (assigned to someone else). */
export function closedByDesigner(span, cfg = config) {
  const done = resolvedInSpan(span)
  const rows = cfg.roster
    .map((r) => {
      const assigned = done.filter((t) => t.a === r.jiraName).length
      const paired = done.filter((t) => t.a !== r.jiraName && t.pair.includes(r.jiraName)).length
      return { name: r.jiraName, assigned, paired, total: assigned + paired }
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return { rows, none: rows.filter((r) => r.total === 0).length, max: Math.max(0, ...rows.map((r) => r.total)) }
}
