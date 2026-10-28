// Replays a ticket's status history (h: [[timestamp, from, to], ...], oldest first) so a window can
// be judged as it was, not only as it is now. Pure functions, no config.

const ms = (iso) => new Date(iso).getTime()

/** Status at the instant atMs, or null if the ticket did not exist yet. No history means the current status. */
export function statusAt(ticket, atMs) {
  if (ticket.c && atMs < ms(ticket.c)) return null
  const h = ticket.h ?? []
  if (!h.length) return ticket.s
  let status = h[0][1] // before the first change it had that change's from-status
  for (const [ts, , to] of h) {
    if (ms(ts) <= atMs) status = to
    else break
  }
  return status
}

/** Status at the end of a window (end is exclusive). A window ending at the pull uses the current status. */
export const statusAtEnd = (ticket, endMs, pullMs) => (endMs >= pullMs ? ticket.s : statusAt(ticket, endMs - 1))

export function inRange(iso, startMs, endMs) {
  if (!iso) return false
  const t = ms(iso)
  return t >= startMs && t < endMs
}

/** Created, resolved, or changed status inside [start, end). Comment-only edits do not count. */
export const hasActivity = (ticket, startMs, endMs) =>
  inRange(ticket.c, startMs, endMs) || inRange(ticket.r, startMs, endMs) || (ticket.h ?? []).some((e) => inRange(e[0], startMs, endMs))

/** Existed before the window ended and was not yet resolved by then. */
export const openAtEnd = (ticket, endMs) => (!ticket.c || ms(ticket.c) < endMs) && (!ticket.r || ms(ticket.r) >= endMs)
