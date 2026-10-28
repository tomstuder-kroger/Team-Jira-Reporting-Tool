import config from './config.js'

export const LABEL = {
  closed: 'Closed',
  prog: 'In Progress',
  review: 'PM Review',
  open: 'Open',
  blocked: 'Blocked',
}

const RANK = { blocked: 0, review: 1, prog: 2, open: 3, closed: 4 }
const WORDS = { closed: 'closed', review: 'in PM review', prog: 'in progress', open: 'still open' }
const ORDER = ['closed', 'review', 'prog', 'open']

export const bucketOf = (item, cfg = config) => cfg.statusBuckets[item.s] || cfg.defaultBucket
export const byRank = (a, b) => RANK[bucketOf(a)] - RANK[bucketOf(b)]

/** "Doe, Jamie A" -> "Jamie Doe"; drops "(NonEmp)" and middle initials. */
export const shortName = (name) => {
  const parts = name.replace(/\s*\(.*?\)/, '').split(', ')
  return parts.length > 1 ? `${parts[1].replace(/ [A-Z]$/, '')} ${parts[0]}` : name
}

export const issueUrl = (key) => `${config.siteUrl}/browse/${key}`

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export const pulledLabel = (meta) =>
  new Date(meta.pulledAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })

export const clockLabel = (date) => date.toLocaleTimeString('en-US', { timeStyle: 'medium' })

const toItem = (t) => ({ k: t.k, t: t.t, s: t.s })
const withAssignee = (t) => ({ ...toItem(t), a: t.a || 'Unassigned' })

/** Factual line from statuses only. Used for every card, for every date range. */
export function autoNote(items, within, cfg = config) {
  const bucket = (t) => bucketOf(t, cfg)
  const parts = ORDER.map((b) => [b, items.filter((t) => bucket(t) === b).length]).filter(([, n]) => n > 0).map(([b, n]) => `${n} ${WORDS[b]}`)
  const blocked = items.filter((t) => bucket(t) === 'blocked').map((t) => t.k)
  const sentences = []
  if (parts.length) sentences.push(`Updated ${within}: ${parts.join(', ')}.`)
  if (blocked.length) sentences.push(`Blocked: ${blocked.join(', ')}.`)
  return sentences.join(' ')
}

/**
 * data: public/data/report.json (version 2). win: a window from windows.js ({ start, within, ... }).
 *
 * A ticket counts for a designer when they are the assignee or are named in the Pair field.
 * It is "moved" in the window when it was resolved in the window, or, if still open, updated in it.
 * Windows end at the pull time, which is exact for "updated" because Jira keeps only the latest one.
 */
export function buildReport(data, win, cfg = config) {
  const startMs = win.start.getTime()
  const rosterNames = cfg.roster.map((r) => r.jiraName)
  const inRoster = (name) => rosterNames.includes(name)
  const bucket = (t) => bucketOf(t, cfg)

  const tickets = data.tickets.filter((t) => inRoster(t.a) || t.pair.some(inRoster))
  const moved = (t) => new Date(t.r ?? t.u).getTime() >= startMs

  const rows = rosterNames.map((name) => {
    const mine = tickets.filter((t) => t.a === name)
    const paired = tickets.filter((t) => t.a !== name && t.pair.includes(name))
    const open = (t) => !t.r

    const own = mine.filter(moved)
    const pair = paired.filter(moved)
    const idle = [...mine, ...paired].filter((t) => open(t) && !moved(t))
    const week = [...own, ...pair]
    const active = week.length > 0

    const openMine = mine.filter(open).length
    const openPaired = paired.filter(open).length
    const quietNote =
      openMine + openPaired === 0
        ? `No open assigned or paired tickets, and none updated ${win.within}.`
        : `${plural(openMine, 'assigned ticket')} and ${plural(openPaired, 'paired ticket')} open. None were updated ${win.within}.`

    return {
      name,
      own: own.map(toItem),
      pair: pair.map(withAssignee),
      idle: idle.map(withAssignee),
      week: week.map(toItem),
      active,
      note: active ? autoNote(week, win.within, cfg) : quietNote,
    }
  })

  const active = rows.filter((d) => d.active)
  const quiet = rows.filter((d) => !d.active)
  const inWindow = tickets.filter(moved)
  const count = (b) => inWindow.filter((t) => bucket(t) === b).length

  const blocked = tickets
    .filter((t) => !t.r && bucket(t) === 'blocked')
    .map((t) => ({
      issue: toItem(t),
      owner: { name: inRoster(t.a) ? t.a : t.pair.find(inRoster) },
      movedThisWeek: moved(t),
    }))

  const kpis = [
    { id: 'active', value: active.length, label: 'Active designers', hint: `${active.filter((d) => d.own.length === 0).length} through paired work only` },
    { id: 'quiet', value: quiet.length, label: 'No activity', hint: `of ${rows.length} tracked` },
    { id: 'closed', value: count('closed'), label: 'Tickets closed', hint: `resolved ${win.within}`, tone: 'success' },
    { id: 'prog', value: count('prog'), label: 'In progress', hint: `updated ${win.within}` },
    { id: 'review', value: count('review'), label: 'Awaiting PM review', hint: 'incl. ready for test', tone: 'warning' },
    { id: 'blocked', value: blocked.length, label: 'Blocked', hint: 'open blockers', tone: 'destructive' },
  ]

  // Designers with blockers first, then by volume in the window.
  const activeSorted = [...active].sort((a, b) => {
    const nb = (d) => d.week.filter((i) => bucket(i) === 'blocked').length
    return nb(b) - nb(a) || b.week.length - a.week.length
  })

  return { rows, active: activeSorted, quiet, blocked, kpis, win }
}
