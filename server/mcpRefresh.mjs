import { mergeReport } from '../scripts/merge-lib.mjs'
import { JiraError } from './errors.mjs'
import { buildQueries } from './queries.mjs'
import { runClaude, extractJsonArray, cleanRows, cleanKeyRows, cleanHistory, searchPrompt, keysPrompt, historyPrompt, countPrompt } from './mcpRunner.mjs'

const DAY = 864e5
const ms = (v) => new Date(v).getTime()
export const DEFAULT_MAX_TOTAL_USD = 5
const PER_RUN_USD = 2
const PAGE_ROWS = 40 // full rows per run
const PAGE_KEYS = 100 // key and updated time only per run
const MAX_PAGES = 100
const SINCE_MARGIN_DAYS = 3 // JQL dates are in the Jira user's time zone and a little behind, so look back past the last pull. Cheap: only keys and updated times are listed for the window
const keyNum = (k) => Number(k.slice(k.lastIndexOf('-') + 1))
const dateOnly = (t) => new Date(t).toISOString().slice(0, 10)

/**
 * Build the next report.json through headless Claude and the Atlassian MCP. Does not write anything.
 *
 * With a usable saved file (version 4 with a pull time) only tickets updated since the last pull are read in full and
 * laid over the saved rows (mode "incremental"). The total is then checked against Jira's own count; if it does not
 * match, a cheap key-and-updated-time listing finds tickets that left the roster or were missed and reads just those
 * (mode "reconciled"). Without a usable saved file, or with `full`, every ticket is read (mode "full").
 * Status history is fetched only for tickets whose updated time differs from the saved file or the resume cache.
 *
 * Everything is read through small runs, paged by ticket key, so Claude never carries a page token or a long list.
 * maxTotalUsd caps the whole refresh: no new run starts once the reported cost reaches it, and each run's own cap is
 * trimmed to what is left. Runs in flight finish, so up to `concurrency` runs can overshoot it a little.
 * cache is a mutable { key: { u, h } } of history already fetched; onCheckpoint(cache) is called after each batch so the
 * caller can save it. run({ prompt, cwd, maxBudgetUsd, onUsage }) -> answer text. Injected in tests.
 */
export async function refreshViaMcp({ cfg, cloudId, previous, full = false, run = runClaude, cwd, now = new Date(), batchSize = 25, concurrency = 3, maxTotalUsd = DEFAULT_MAX_TOTAL_USD, model, cache = {}, onCheckpoint = () => {}, onProgress = () => {} }) {
  concurrency = Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 3 // a bad value must never mean "start no workers" and read nothing
  let costUsd = 0
  let runs = 0
  const ask = async (prompt) => {
    const left = maxTotalUsd - costUsd
    if (left <= 0) {
      throw new JiraError(`The refresh stopped at its spending limit of $${maxTotalUsd.toFixed(2)} (about $${costUsd.toFixed(2)} used), so the saved data was left as it was. History already read is kept, so choosing Refresh again continues where this stopped. To spend more per refresh, raise REFRESH_MAX_USD in .env; to read fewer tickets, lower historyDays.`)
    }
    const text = await run({ prompt, cwd, model, maxBudgetUsd: Math.min(PER_RUN_USD, left), onUsage: (u) => { costUsd += u.costUsd ?? 0 } })
    runs += 1
    return extractJsonArray(text)
  }
  // Every progress update carries what the refresh has spent so far and its limit, for the page's banner.
  const report = (p) => onProgress({ ...p, costUsd: Math.round(costUsd * 100) / 100, maxUsd: maxTotalUsd })
  // Tickets that belong in the report: the same search as the REST route, so a count check compares like with like.
  const poolJql = buildQueries(cfg).pool.replace(/ ORDER BY.*$/, '') // also checks the config
  const base = (project, roster = cfg.roster) => buildQueries({ ...cfg, roster, projects: [project] }).pool.replace(/ ORDER BY.*$/, '')

  // Run `task` for each project, a few at a time, stopping new ones after a failure.
  const eachProject = async (task) => {
    const queue = [...cfg.projects]
    let failed = false
    const worker = async () => {
      while (!failed && queue.length) {
        try { await task(queue.shift()) } catch (e) { failed = true; throw e }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  }

  // Page one project's tickets by key (`key > "ABC-123" ORDER BY key ASC`), calling onPage(rows) for each page.
  const pageProject = async (project, extra, { size, prompt, clean, onPage, roster }) => {
    let after = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const jql = `${base(project, roster)}${extra}${after ? ` AND key > "${after}"` : ''} ORDER BY key ASC`
      const got = clean(await ask(prompt(jql)))
      if (got.some((r) => !r.k.startsWith(`${project}-`))) throw new JiraError(`Claude returned a ticket from outside ${project}, so the saved data was left as it was.`)
      onPage(got)
      if (got.length < size) return
      const top = got.reduce((m, r) => (keyNum(r.k) > keyNum(m) ? r.k : m), got[0].k)
      if (after && keyNum(top) <= keyNum(after)) throw new JiraError(`Reading ${project} tickets did not move forward, so the saved data was left as it was.`)
      after = top
    }
    throw new JiraError(`${project} has more tickets than a refresh will page through.`)
  }

  let projectsDone = 0
  const readRows = async (extra, into, roster) => {
    projectsDone = 0
    report({ phase: 'tickets', done: 0, total: cfg.projects.length, rows: 0 })
    await eachProject(async (project) => {
      await pageProject(project, extra, {
        roster, size: PAGE_ROWS, clean: cleanRows, prompt: (jql) => searchPrompt({ cloudId, jql, cfg, pageSize: PAGE_ROWS }),
        onPage: (got) => { for (const r of got) into.set(r.k, r); report({ phase: 'tickets', done: projectsDone, total: cfg.projects.length, rows: into.size }) },
      })
      projectsDone += 1
      report({ phase: 'tickets', done: projectsDone, total: cfg.projects.length, rows: into.size })
    })
  }

  // Just key and updated time for a search: short answers, so listing a whole window is cheap.
  const listKeys = async (extra, roster) => {
    const listed = new Map()
    let done = 0
    report({ phase: 'tickets', done: 0, total: cfg.projects.length, rows: 0 })
    await eachProject(async (project) => {
      await pageProject(project, extra, {
        roster, size: PAGE_KEYS, clean: cleanKeyRows, prompt: (jql) => keysPrompt({ cloudId, jql, cfg, pageSize: PAGE_KEYS }),
        onPage: (got) => { for (const r of got) listed.set(r.k, r.u) },
      })
      done += 1
      report({ phase: 'tickets', done, total: cfg.projects.length, rows: listed.size })
    })
    return listed
  }

  // Full rows for a list of keys, a page at a time and a few at once. Each page must come back as exactly the tickets asked for.
  const readByKeys = async (keys, into) => {
    const pages = []
    for (let i = 0; i < keys.length; i += PAGE_ROWS) pages.push(keys.slice(i, i + PAGE_ROWS))
    let next = 0
    let failed = false
    const worker = async () => {
      while (!failed && next < pages.length) {
        const ks = pages[next++]
        try {
          const got = cleanRows(await ask(searchPrompt({ cloudId, jql: `key in (${ks.map((k) => `"${k}"`).join(', ')}) ORDER BY key ASC`, cfg, pageSize: PAGE_ROWS })))
          const gotKeys = new Set(got.map((r) => r.k))
          if (ks.some((k) => !gotKeys.has(k)) || got.some((r) => !ks.includes(r.k))) throw new JiraError('Claude did not return exactly the tickets asked for, so the saved data was left as it was.')
          for (const r of got) into.set(r.k, r)
        } catch (e) { failed = true; throw e }
        report({ phase: 'changed', done: into.size, total: keys.length })
      }
    }
    if (keys.length) report({ phase: 'changed', done: 0, total: keys.length })
    await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker))
  }

  const countNow = async () => {
    report({ phase: 'check' })
    const [expected] = await ask(countPrompt({ cloudId, jql: poolJql }))
    if (!Number.isInteger(expected)) throw new JiraError('Claude did not return a ticket count to check against.')
    return expected
  }

  const saved = new Map((previous?.tickets ?? []).map((t) => [t.k, t]))
  const canIncrement = !full && previous?.version === 4 && saved.size > 0 && Number.isFinite(ms(previous?.meta?.pulledAt))
  const rows = new Map()
  let mode = 'full'
  let rowsRead = 0
  let addedNames = []
  let pruned = 0

  if (canIncrement) {
    mode = 'incremental'
    // Saved rows, with the tickets changed since the last pull laid over them.
    for (const t of saved.values()) rows.set(t.k, { k: t.k, t: t.t, s: t.s, a: t.a, pair: t.pair, c: t.c, u: t.u, r: t.r, y: t.y, z: t.z, d: t.d, sd: t.sd, rk: t.rk })
    // Who is tracked now against who was tracked at the last pull. Removed people cost nothing: tickets nobody tracked any
    // more are dropped from the saved rows. Added people are read in full, whatever their tickets' updated times.
    const tracked = new Set(cfg.roster.map((r) => r.jiraName))
    for (const [k, r] of rows) {
      if (!tracked.has(r.a) && !(r.pair ?? []).some((n) => tracked.has(n))) { rows.delete(k); pruned += 1 }
    }
    if (Array.isArray(previous.meta.roster)) {
      const had = new Set(previous.meta.roster)
      addedNames = [...tracked].filter((n) => !had.has(n))
    }

    // Look first, then read: list key and updated time for everything touched since the last pull (and for the new
    // people's tickets), and read in full only what is new or whose updated time differs from the saved row.
    const readChanged = async (extra, roster) => {
      const listed = await listKeys(extra, roster)
      const changed = [...listed].filter(([k, u]) => !rows.has(k) || ms(rows.get(k).u) !== ms(u)).map(([k]) => k)
      const got = new Map()
      await readByKeys(changed, got)
      for (const r of got.values()) rows.set(r.k, r)
      rowsRead += got.size
    }
    const since = dateOnly(ms(previous.meta.pulledAt) - SINCE_MARGIN_DAYS * DAY)
    await readChanged(` AND updated >= "${since}"`)
    if (addedNames.length) await readChanged('', addedNames.map((jiraName) => ({ jiraName })))

    // A ticket resolved before the history window drops out of the search; do the same to the saved rows.
    const oldest = ms(now) - cfg.historyDays * DAY
    let nearEdge = 0 // tickets resolved within a day of the cutoff: Jira's idea of "366 days ago" can differ from ours by a ticket or two
    for (const [k, r] of rows) {
      if (!r.r) continue
      if (Math.abs(ms(r.r) - oldest) <= DAY) nearEdge += 1
      if (ms(r.r) < oldest) rows.delete(k)
    }

    // The saved rows plus the changes must add up to what Jira reports, give or take the tickets sitting on the age
    // cutoff. If not, something left the roster or was missed.
    const expected = await countNow()
    if (Math.abs(rows.size - expected) > nearEdge) {
      mode = 'reconciled'
      report({ phase: 'reconcile', done: 0, total: cfg.projects.length })
      const live = await listKeys('', cfg.roster)
      if (Math.abs(live.size - expected) > 2) throw new JiraError(`Claude listed ${live.size} tickets but Jira reports ${expected}, so the saved data was left as it was.`)
      for (const k of [...rows.keys()]) if (!live.has(k)) rows.delete(k)
      const missing = [...live].filter(([k, u]) => !rows.has(k) || ms(rows.get(k).u) !== ms(u)).map(([k]) => k)
      const got = new Map()
      await readByKeys(missing, got)
      for (const r of got.values()) rows.set(r.k, r)
      rowsRead += got.size
      if (rows.size !== live.size) throw new JiraError('The saved tickets could not be reconciled with Jira, so the saved data was left as it was. Try a full refresh.')
    }
  } else {
    await readRows('', rows)
    rowsRead = rows.size
    if (rows.size === 0) throw new JiraError('Jira returned no tickets for the roster, so the saved data was left as it was.')
    // A short answer from Claude would silently drop tickets, so compare with Jira's own count. A couple of tickets can
    // change between the two calls, so a small difference is allowed.
    const expected = await countNow()
    if (Math.abs(rows.size - expected) > Math.max(2, Math.ceil(expected * 0.01))) {
      throw new JiraError(`Claude returned ${rows.size} tickets but Jira reports ${expected}, so the saved data was left as it was.`)
    }
  }
  if (rows.size === 0) throw new JiraError('Jira returned no tickets for the roster, so the saved data was left as it was.')

  // Saved history is reusable for a ticket whose updated time still matches, from the last report or from the resume
  // cache a failed refresh left behind.
  const known = (r) => {
    const p = saved.get(r.k)
    if (p && Array.isArray(p.h) && ms(p.u) === ms(r.u)) return p.h
    const c = cache[r.k]
    if (c && Array.isArray(c.h) && ms(c.u) === ms(r.u)) return c.h
    return null
  }
  const stale = [...rows.values()].filter((r) => known(r) === null).map((r) => r.k)
  const batches = []
  for (let i = 0; i < stale.length; i += batchSize) batches.push(stale.slice(i, i + batchSize))

  const history = new Map()
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < batches.length) {
      const keys = batches[next++]
      try {
        for (const [k, h] of cleanHistory(await ask(historyPrompt({ cloudId, keys })), keys)) {
          history.set(k, h)
          cache[k] = { u: rows.get(k).u, h }
        }
        onCheckpoint(cache) // so a later failure does not lose what is already paid for
      } catch (e) {
        failed = true // other workers stop picking up new batches
        throw e
      }
      report({ phase: 'history', done: history.size, total: stale.length })
    }
  }
  report({ phase: 'history', done: 0, total: stale.length })
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  const pool = [...rows.values()].map((r) => ({ ...r, h: history.get(r.k) ?? known(r) }))
  const { data, warnings } = mergeReport({ pool, config: cfg, now: now.toISOString() })
  const closed = data.tickets.filter((t) => t.r).length
  return {
    data,
    summary: {
      tickets: data.tickets.length,
      open: data.tickets.length - closed,
      closed,
      historyDays: data.meta.historyDays,
      pulledAt: data.meta.pulledAt,
      warnings,
      route: 'mcp',
      mode,
      rowsRead,
      added: addedNames,
      pruned,
      refetched: stale.length,
      runs,
      costUsd: Math.round(costUsd * 100) / 100,
    },
  }
}
