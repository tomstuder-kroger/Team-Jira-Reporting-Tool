import { mergeReport } from '../scripts/merge-lib.mjs'
import { JiraError } from './errors.mjs'
import { buildQueries } from './queries.mjs'

/** One Jira issue from the search -> the row shape merge-lib expects. */
export function toPoolRow(issue, cfg) {
  const f = issue.fields ?? {}
  const people = Array.isArray(f[cfg.pairFieldId]) ? f[cfg.pairFieldId] : []
  return {
    k: issue.key,
    t: String(f.summary ?? '').replace(/\s+/g, ' ').trim(),
    s: f.status?.name ?? 'Unknown',
    a: f.assignee?.displayName ?? null,
    pair: people.map((u) => u?.displayName).filter(Boolean),
    c: f.created ?? null,
    u: f.updated ?? null,
    r: f.resolutiondate ?? null,
  }
}

const FIELDS = (cfg) => ['summary', 'status', 'assignee', cfg.pairFieldId, 'created', 'updated', 'resolutiondate']

/**
 * Query Jira and build the next report.json. Does not write anything.
 * client: { searchAll(jql, fields) }
 */
export async function refreshReport({ cfg, client, now = new Date() }) {
  const q = buildQueries(cfg)
  const issues = await client.searchAll(q.pool, FIELDS(cfg))

  // An empty answer for a whole roster means something is wrong. Keep the old file rather than wipe it.
  if (issues.length === 0) throw new JiraError('Jira returned no tickets for the roster, so the saved data was left as it was.')

  const { data, warnings } = mergeReport({ pool: issues.map((i) => toPoolRow(i, cfg)), config: cfg, now: now.toISOString() })
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
    },
  }
}
