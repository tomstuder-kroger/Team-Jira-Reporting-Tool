import config from './config.js'

// Blocked spells, from each ticket's status history (h: [[timestamp, from, to], ...], oldest first).
//
// A spell starts when a ticket moves into a status that statusBuckets maps to Blocked. It ends at
// the next change out of that status, or at the resolved time, or stays open until the pull.
// If a ticket's first recorded change leaves Blocked, it was blocked from the moment it was created.
// Membership uses the current roster and the current assignee, like every other count in the app.

const DAY_MS = 864e5

const isBlocked = (status, cfg) => (cfg.statusBuckets[status] || cfg.defaultBucket) === 'blocked'
const ms = (iso) => new Date(iso).getTime()

/** Spells for one ticket: [{ start, end, open }] in ms. `end` is the pull while the spell is open. */
export function spellsFor(ticket, pullMs, cfg = config) {
  const h = ticket.h ?? []
  const spells = []
  let start = null

  if (h.length && isBlocked(h[0][1], cfg) && ticket.c) start = ms(ticket.c)

  for (const [ts, from, to] of h) {
    const t = ms(ts)
    const was = isBlocked(from, cfg)
    const now = isBlocked(to, cfg)
    if (start === null && !was && now) start = t
    else if (start !== null && was && !now) {
      spells.push({ start, end: t, open: false })
      start = null
    }
  }

  if (start !== null) {
    const resolved = ticket.r ? ms(ticket.r) : null
    // A ticket resolved while still in Blocked ends its spell at the resolved time.
    if (resolved !== null) spells.push({ start, end: Math.max(start, resolved), open: false })
    else spells.push({ start, end: pullMs, open: true })
  }
  return spells
}

const median = (nums) => {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const round1 = (n) => Math.round(n * 10) / 10

/**
 * span: the result of buildWeeks (weeks, tickets, anchor). Adds per-week numbers to each week and
 * returns the headline figures.
 *
 * newlyBlocked: spells that started in the week. blockedAtEnd: tickets blocked when the week ended
 * (at the pull for the week in progress).
 */
export function blockedOverTime(span, cfg = config) {
  const pull = span.anchor.getTime()
  const spells = span.tickets.flatMap((t) => spellsFor(t, pull, cfg).map((s) => ({ ...s, key: t.k })))

  const weeks = span.weeks.map((w) => {
    const startMs = w.start.getTime()
    const endMs = w.end.getTime()
    const newly = spells.filter((s) => s.start >= startMs && s.start < endMs)
    // Blocked at the end of the week: the spell began before the end and had not finished by it.
    const atEnd = new Set(spells.filter((s) => s.start < endMs && (s.open || s.end >= endMs)).map((s) => s.key))
    return { ...w, newlyBlocked: newly.length, blockedAtEnd: atEnd.size }
  })

  const current = spells.filter((s) => s.open)
  const from = span.from ? span.from.getTime() : Infinity
  const finished = spells.filter((s) => !s.open && s.end >= from && s.end <= pull)
  const finishedDays = finished.map((s) => (s.end - s.start) / DAY_MS)
  const med = median(finishedDays)

  return {
    weeks,
    currentCount: new Set(current.map((s) => s.key)).size,
    longestCurrentDays: current.length ? round1(Math.max(...current.map((s) => (pull - s.start) / DAY_MS))) : null,
    medianDays: med === null ? null : round1(med),
    finishedCount: finished.length,
  }
}

/** Whole days the ticket has been blocked as of the pull, or null if it is not in an open spell. */
export function daysBlocked(ticket, pullMs, cfg = config) {
  const open = spellsFor(ticket, pullMs, cfg).find((s) => s.open)
  return open ? Math.floor((pullMs - open.start) / DAY_MS) : null
}
