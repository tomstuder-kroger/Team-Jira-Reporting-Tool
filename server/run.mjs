import path from 'node:path'
import { SetupError } from './errors.mjs'
import { readConfig } from './config.mjs'
import { createJiraClient } from './jira.mjs'
import { refreshReport } from './refresh.mjs'
import { writeReport } from './store.mjs'

/** Shared by the page's Refresh button and `npm run data:jira`. Returns the summary. */
export async function runRefresh({ root, env, fetchImpl, now = new Date(), outFile }) {
  const reportFile = path.join(root, 'public/data/report.json')
  const cfg = readConfig(root)
  const email = env.JIRA_EMAIL
  const token = env.JIRA_API_TOKEN
  if (!email || !token) {
    throw new SetupError('Jira credentials are not set. Add JIRA_EMAIL and JIRA_API_TOKEN to .env, then restart npm start.')
  }
  const client = createJiraClient({ email, token, cloudId: env.JIRA_CLOUD_ID || cfg.cloudId, fetchImpl })
  const { data, summary } = await refreshReport({ cfg, client, now })
  writeReport(outFile ?? reportFile, data)
  return summary
}
