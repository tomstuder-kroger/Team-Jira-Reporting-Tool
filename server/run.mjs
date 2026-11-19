import fs from 'node:fs'
import path from 'node:path'
import { SetupError } from './errors.mjs'
import { readConfig } from './config.mjs'
import { createJiraClient } from './jira.mjs'
import { refreshReport } from './refresh.mjs'
import { refreshViaMcp } from './mcpRefresh.mjs'
import { readReport, writeReport } from './store.mjs'

/**
 * Which route a refresh takes. REFRESH_ROUTE=mcp or rest in .env forces one; otherwise the REST route is used when
 * JIRA_EMAIL and JIRA_API_TOKEN are set and the Atlassian MCP route (headless Claude Code) when they are not.
 */
export function chooseRoute(env) {
  if (env.REFRESH_ROUTE === 'mcp' || env.REFRESH_ROUTE === 'rest') return env.REFRESH_ROUTE
  return env.JIRA_EMAIL && env.JIRA_API_TOKEN ? 'rest' : 'mcp'
}

/** Shared by the page's Refresh button and `npm run data:jira`. Returns the summary. */
export async function runRefresh({ root, env, fetchImpl, now = new Date(), outFile, onProgress, mcpRun, full = false }) {
  const reportFile = outFile ?? path.join(root, 'public/data/report.json')
  const cfg = readConfig(root)
  const cloudId = env.JIRA_CLOUD_ID || cfg.cloudId

  if (chooseRoute(env) === 'mcp') {
    if (!cloudId) throw new SetupError('The Jira cloud ID is not set. Add cloudId to config/report.config.json.')
    // Reuse saved status history for tickets that have not changed. An older or unreadable file means a full pull.
    const saved = readReport(path.join(root, 'public/data/report.json'))
    const previous = saved && (saved.version === 3 || saved.version === 4) && Array.isArray(saved.tickets) ? saved : null
    // History already paid for survives a failed refresh in this git-ignored file, and is removed after a good one.
    const cacheFile = path.join(root, 'data-raw/mcp-history-cache.json')
    const cache = readReport(cacheFile) ?? {}
    const max = Number(env.REFRESH_MAX_USD)
    const startedAt = Date.now()
    const { data, summary } = await refreshViaMcp({
      cfg, cloudId, previous, full, now, onProgress, cache,
      onCheckpoint: (c) => writeReport(cacheFile, c),
      ...(Number.isFinite(max) && max > 0 ? { maxTotalUsd: max } : {}),
      ...(env.REFRESH_MODEL ? { model: env.REFRESH_MODEL } : {}),
      ...(Number.isInteger(Number(env.REFRESH_CONCURRENCY)) && Number(env.REFRESH_CONCURRENCY) >= 1 && Number(env.REFRESH_CONCURRENCY) <= 8 ? { concurrency: Number(env.REFRESH_CONCURRENCY) } : {}),
      ...(mcpRun ? { run: mcpRun } : {}),
    })
    writeReport(reportFile, data)
    fs.rmSync(cacheFile, { force: true })
    summary.seconds = Math.round((Date.now() - startedAt) / 1000)
    console.log(`[refresh] mcp route (${summary.mode}): ${summary.tickets} tickets, ${summary.rowsRead} rows read, ${summary.refetched} histories refetched, ${summary.runs} Claude runs, about $${summary.costUsd.toFixed(2)}, ${summary.seconds}s`)
    return summary
  }

  const email = env.JIRA_EMAIL
  const token = env.JIRA_API_TOKEN
  if (!email || !token) {
    throw new SetupError('Jira credentials are not set. Add JIRA_EMAIL and JIRA_API_TOKEN to .env, then restart npm start.')
  }
  const client = createJiraClient({ email, token, cloudId, fetchImpl })
  const { data, summary } = await refreshReport({ cfg, client, now })
  writeReport(reportFile, data)
  return summary
}
