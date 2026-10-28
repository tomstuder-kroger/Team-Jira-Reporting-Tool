import { ConfigError } from './errors.mjs'

const quote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
const PROJECT = /^[A-Za-z][A-Za-z0-9_]*$/

export function assertConfig(cfg) {
  if (!Array.isArray(cfg?.roster) || cfg.roster.length === 0) throw new ConfigError('config/report.config.json has an empty roster.')
  if (cfg.roster.some((r) => !r?.jiraName || typeof r.jiraName !== 'string')) throw new ConfigError('Every roster entry needs a jiraName.')
  if (!Array.isArray(cfg.projects) || cfg.projects.length === 0 || !cfg.projects.every((p) => PROJECT.test(p))) throw new ConfigError('config/report.config.json projects must be Jira project keys such as ERSD.')
  if (!Array.isArray(cfg.issueTypes) || cfg.issueTypes.length === 0) throw new ConfigError('config/report.config.json issueTypes is empty.')
  if (!Number.isInteger(cfg.historyDays) || cfg.historyDays < 30 || cfg.historyDays > 366) throw new ConfigError('historyDays must be a whole number from 30 to 366.')
  if (!/^customfield_\d+$/.test(cfg.pairFieldId ?? '') || !/^cf\[\d+\]$/.test(cfg.pairJqlField ?? '')) throw new ConfigError('pairFieldId and pairJqlField must look like customfield_12345 and cf[12345].')
}

/**
 * One search: every roster ticket that is open, or was resolved inside the history window.
 * The page filters this by date range, so changing the range never calls Jira.
 */
export function buildQueries(cfg) {
  assertConfig(cfg)
  const names = cfg.roster.map((r) => quote(r.jiraName)).join(', ')
  const base =
    `project IN (${cfg.projects.join(', ')}) AND issuetype IN (${cfg.issueTypes.map(quote).join(', ')})` +
    ` AND (assignee IN (${names}) OR ${cfg.pairJqlField} IN (${names}))`
  return {
    pool: `${base} AND (statusCategory != Done OR resolved >= -${cfg.historyDays}d) ORDER BY assignee, status`,
  }
}
