// Pure merge step shared by the Jira refresh and `npm run data:merge`. No file or network access.
//
// pool: every roster ticket that is open, or resolved inside the history window.
//       [{ k, t, s, a, pair: [displayName], c, u, r, h }]
//       a = assignee display name or null; c, u, r = created, updated, resolved timestamps (r null while open).
//       h = status changes [[timestamp, fromStatus, toStatus], ...], any order; optional.
// now:  ISO timestamp of the pull. Date ranges on the page are measured back from it.
//
// Output (version 3) carries timestamps and status changes only. Which tickets count as active, and the card notes,
// are worked out in the browser for whichever date range is selected.

export const DATA_VERSION = 3
const DAY_MS = 864e5

/** Normalise any parseable timestamp to UTC ISO. null for empty, undefined for unparseable. */
const iso = (v) => {
  if (v === null || v === undefined || v === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** Keep well-formed [timestamp, from, to] entries, timestamps in UTC, oldest first. */
const history = (h) =>
  (Array.isArray(h) ? h : [])
    .filter((e) => Array.isArray(e) && e.length === 3 && typeof e[1] === 'string' && typeof e[2] === 'string')
    .map(([ts, from, to]) => [iso(ts), from, to])
    .filter(([ts]) => ts)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

export function mergeReport({ pool, config, now }) {
  const pulledAt = iso(now)
  if (!pulledAt) throw new Error('mergeReport needs a valid "now" timestamp.')

  const warnings = []
  const roster = new Set(config.roster.map((r) => r.jiraName))

  const seen = new Map()
  for (const t of pool) {
    if (seen.has(t.k)) warnings.push(`Duplicate ticket ${t.k}; keeping the first.`)
    else seen.set(t.k, t)
  }

  const tickets = []
  for (const t of seen.values()) {
    const pair = [...new Set(t.pair ?? [])]
    if (!roster.has(t.a) && !pair.some((p) => roster.has(p))) {
      warnings.push(`${t.k} is not assigned to or paired with anyone on the roster; dropped.`)
      continue
    }
    const u = iso(t.u)
    if (!u) {
      warnings.push(`${t.k} has no usable updated date; dropped.`)
      continue
    }
    if (!(t.s in config.statusBuckets)) {
      warnings.push(`${t.k} has status "${t.s}", which is not in statusBuckets; it will show as ${config.defaultBucket}.`)
    }
    tickets.push({ k: t.k, t: t.t, s: t.s, a: t.a ?? null, pair, c: iso(t.c) ?? null, u, r: iso(t.r) ?? null, h: history(t.h) })
  }

  const data = {
    version: DATA_VERSION,
    meta: {
      pulledAt,
      historyDays: config.historyDays,
      historyStart: new Date(new Date(pulledAt).getTime() - config.historyDays * DAY_MS).toISOString(),
      source: config.siteUrl.replace(/^https?:\/\//, ''),
    },
    tickets,
  }
  return { data, warnings }
}
