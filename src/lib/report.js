import config from './config.js'
import { daysBlocked } from './blocked.js'
import { hasActivity, inRange, openAtEnd, statusAtEnd } from './history.js'

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

/** Factual line from statuses only. Used for every card, for every date range. */
export function autoNote(items, within, cfg = config) {
  const bucket = (t) => bucketOf(t, cfg)
  const parts = ORDER.map((b) => [b, items.filter((t) => bucket(t) === b).length]).filter(([, n]) => n > 0).map(([b, n]) => `${n} ${WORDS[b]}`)
  const blocked = items.filter((t) => bucket(t) === 'blocked').map((t) => t.k)
  const sentences = []
  if (parts.length) sentences.push(`Activity ${within}: ${parts.join(', ')}.`)
  if (blocked.length) sentences.push(`Blocked: ${blocked.join(', ')}.`)
  return sentences.join(' ')
}

/**
 * Everything for one window. A ticket counts for a designer when they are the assignee or are named
 * in the Pair field. It counts in the window when it was created, resolved, or changed status in it
 * (comment-only edits do not count). Statuses shown are the ones at the end of the window, replayed
 * from each ticket's status history.
 */
function compute(data, win, cfg) {
  const startMs = win.start.getTime()
  const endMs = win.end.getTime()
  const pullMs = new Date(data.meta.pulledAt).getTime()
  const rosterNames = cfg.roster.map((r) => r.jiraName)
  const inRoster = (name) => rosterNames.includes(name)
  const statusEnd = (t) => statusAtEnd(t, endMs, pullMs) ?? t.s
  const bucket = (t) => bucketOf({ s: statusEnd(t) }, cfg)
  const toItem = (t) => ({ k: t.k, t: t.t, s: statusEnd(t) })
  const withAssignee = (t) => ({ ...toItem(t), a: t.a || 'Unassigned' })

  const tickets = data.tickets.filter((t) => inRoster(t.a) || t.pair.some(inRoster))
  const counted = (t) => hasActivity(t, startMs, endMs)
  const open = (t) => openAtEnd(t, endMs)

  const rows = rosterNames.map((name) => {
    const mine = tickets.filter((t) => t.a === name)
    const paired = tickets.filter((t) => t.a !== name && t.pair.includes(name))

    const own = mine.filter(counted)
    const pair = paired.filter(counted)
    const idle = [...mine, ...paired].filter((t) => open(t) && !counted(t))
    const week = [...own, ...pair]
    const active = week.length > 0

    const openMine = mine.filter(open).length
    const openPaired = paired.filter(open).length
    const quietNote =
      openMine + openPaired === 0
        ? `No open assigned or paired tickets, and no activity ${win.within}.`
        : `${plural(openMine, 'assigned ticket')} and ${plural(openPaired, 'paired ticket')} open. No activity ${win.within}.`

    return {
      name,
      own: own.map(toItem),
      pair: pair.map(withAssignee),
      idle: idle.map(withAssignee),
      week: week.map(toItem),
      active,
      note: active ? autoNote(week.map(toItem), win.within, cfg) : quietNote,
    }
  })

  const active = rows.filter((d) => d.active)
  const quiet = rows.filter((d) => !d.active)
  const inWindow = tickets.filter(counted)
  const closedN = inWindow.filter((t) => inRange(t.r, startMs, endMs)).length
  const count = (b) => inWindow.filter((t) => bucket(t) === b).length

  // Blocked at the end of the window. For a window ending at the last pull this is today's blocked list.
  const atMs = endMs >= pullMs ? pullMs : endMs - 1
  const blocked = tickets
    .filter((t) => open(t) && bucket(t) === 'blocked')
    .map((t) => ({
      issue: toItem(t),
      owner: { name: inRoster(t.a) ? t.a : t.pair.find(inRoster) },
      movedThisWeek: counted(t),
      days: daysBlocked(t, pullMs, cfg, atMs),
    }))

  const kpis = [
    { id: 'active', value: active.length, label: 'Active designers', hint: `${active.filter((d) => d.own.length === 0).length} through paired work only` },
    { id: 'quiet', value: quiet.length, label: 'No activity', hint: `of ${rows.length} tracked` },
    { id: 'closed', value: closedN, label: 'Tickets closed', hint: `resolved ${win.within}`, tone: 'success' },
    { id: 'prog', value: count('prog'), label: 'In progress', hint: 'at the end of the range' },
    { id: 'review', value: count('review'), label: 'Awaiting PM review', hint: 'incl. ready for test', tone: 'warning' },
    { id: 'blocked', value: blocked.length, label: 'Blocked', hint: 'blocked at the end of the range', tone: 'destructive' },
  ]

  // Designers with blockers first, then by volume in the window.
  const activeSorted = [...active].sort((a, b) => {
    const nb = (d) => d.week.filter((i) => bucketOf(i, cfg) === 'blocked').length
    return nb(b) - nb(a) || b.week.length - a.week.length
  })

  return { rows, active: activeSorted, quiet, blocked, kpis, win }
}

// Which direction is good news for each tile, so the page can color a change. null = neutral.
const GOOD = { active: 'up', quiet: 'down', closed: 'up', prog: null, review: null, blocked: 'down' }

/**
 * data: public/data/report.json (version 3). win: a window from windows.js ({ start, end, within, compare, ... }).
 * When win.compare is set and usable, each tile also carries the value for that earlier window and the change.
 */
export function buildReport(data, win, cfg = config) {
  const report = compute(data, win, cfg)
  if (win.compare?.ok) {
    const before = compute(data, { start: win.compare.start, end: win.compare.end, within: win.compare.within }, cfg)
    report.kpis = report.kpis.map((k) => {
      const prev = before.kpis.find((p) => p.id === k.id).value
      return { ...k, prev, change: k.value - prev, good: GOOD[k.id] }
    })
    report.compare = win.compare
  }
  return report
}
