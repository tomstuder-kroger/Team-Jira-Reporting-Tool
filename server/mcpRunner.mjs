import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JiraError, SetupError } from './errors.mjs'

// Runs headless Claude Code (`claude -p`) against the Atlassian MCP using the owner's own sign-in.
// Claude only fetches and returns JSON; this server validates it and writes the file. Read-only by construction:
// the allowlist has only executeRead (which runs read-tier operations: the search, the count and the changelog),
// and every write or destructive tool is denied by name. The direct search tool is denied too: only executeRead can
// slim a search response with responseFields, which keeps emails and account IDs out of Claude's context.

const MCP = 'mcp__atlassian__'
export const ALLOWED_TOOLS = [`${MCP}executeRead`]
export const DENIED_TOOLS = [
  `${MCP}searchJiraIssuesUsingJql`, `${MCP}executeWrite`, `${MCP}executeDestructive`, `${MCP}createJiraIssue`, `${MCP}editJiraIssue`,
  `${MCP}transitionJiraIssue`, `${MCP}addOrEditJiraIssueComment`, `${MCP}createConfluenceContent`, `${MCP}updateConfluenceContent`,
  'Bash', 'Write', 'Edit', 'NotebookEdit',
]

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/
const EMAIL = /\S+@\S+\.\S+/
const DATE = /^\d{4}-\d{2}-\d{2}/

// A bare relay: a run in an empty folder (no project instructions), with only the Atlassian server, user settings only,
// no skills and no built-in tools. Measured at about $0.03 a run against $0.35 with the full project and plugin context.
// `--bare` would be leaner still but only accepts an ANTHROPIC_API_KEY, not the Claude Code sign-in.
export const ATLASSIAN_MCP_CONFIG = JSON.stringify({ mcpServers: { atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp' } } })
const SYSTEM_PROMPT = "You are a read-only data relay. Follow the user's instructions exactly and reply with only what they ask for."

/** An empty folder to run in, so no CLAUDE.md or project settings are loaded. */
export function emptyWorkDir() {
  const dir = path.join(os.tmpdir(), 'designer-activity-report-claude')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function buildClaudeArgs({ prompt, maxBudgetUsd = 2, model }) {
  return [
    ...(model ? ['--model', model] : []),
    '-p', prompt,
    '--output-format', 'json',
    '--strict-mcp-config', '--mcp-config', ATLASSIAN_MCP_CONFIG,
    '--setting-sources', 'user',
    '--disable-slash-commands',
    '--tools', '',
    '--system-prompt', SYSTEM_PROMPT,
    '--allowedTools', ALLOWED_TOOLS.join(','),
    '--disallowedTools', DENIED_TOOLS.join(','),
    '--max-budget-usd', String(maxBudgetUsd),
    '--no-session-persistence',
  ]
}

/** Runs one headless call and returns Claude's final answer text. Messages are safe to show in the page. */
export function runClaude({ prompt, cwd, model, spawnImpl = spawn, timeoutMs = 300000, maxBudgetUsd, onUsage }) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl('claude', buildClaudeArgs({ prompt, maxBudgetUsd, model }), { cwd: cwd ?? emptyWorkDir(), stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      return reject(new SetupError('Could not start Claude Code. Is the claude command installed and on your PATH?'))
    }
    let out = ''
    const timer = setTimeout(() => {
      child.kill?.()
      reject(new JiraError('The refresh through Claude took too long and was stopped. The saved data was left as it was.'))
    }, timeoutMs)
    child.stdout?.on('data', (d) => { out += d })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e?.code === 'ENOENT' ? new SetupError('Could not find the claude command. Install Claude Code and make sure it is on your PATH.') : new JiraError('Claude Code could not be started.'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      let env
      try { env = JSON.parse(out) } catch { return reject(new JiraError(`Claude Code returned something unreadable (exit ${code}).`)) }
      if (env.is_error || env.subtype !== 'success') {
        const why = /budget/i.test(String(env.subtype)) ? 'it hit its spending limit' : `it stopped early (${String(env.subtype ?? 'unknown')})`
        return reject(new JiraError(`The refresh through Claude did not finish: ${why}. Sign in again with /mcp if this keeps happening.`))
      }
      onUsage?.({ costUsd: env.total_cost_usd ?? null, durationMs: env.duration_ms ?? null, turns: env.num_turns ?? null })
      resolve(String(env.result ?? ''))
    })
  })
}

/** Pulls the JSON array out of an answer, tolerating a code fence around it. */
export function extractJsonArray(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = t.indexOf('[')
  const end = t.lastIndexOf(']')
  if (start < 0 || end < start) {
    // What Claude said goes to the terminal running the app, not to the page, so a stop-early explanation is not a mystery.
    console.error(`[refresh] Claude did not return a list. It said: ${t.slice(0, 400).replace(/\s+/g, ' ')}`)
    throw new JiraError('Claude did not return a list of tickets (it stopped early or answered in words). What it said is in the terminal running npm start.')
  }
  try {
    const v = JSON.parse(t.slice(start, end + 1))
    if (!Array.isArray(v)) throw new Error('not an array')
    return v
  } catch {
    throw new JiraError('Claude returned tickets that could not be read as JSON.')
  }
}

const strOrNull = (v) => (typeof v === 'string' && v ? v : null)
const stamp = (v) => (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v : null)

/** Status changes [[timestamp, from, to], ...]. Throws if any entry is malformed. */
function cleanH(k, h) {
  const ok = Array.isArray(h) && h.every((e) => Array.isArray(e) && e.length === 3 && stamp(e[0]) && typeof e[1] === 'string' && typeof e[2] === 'string')
  if (!ok) throw new JiraError(`Ticket ${k} from Claude was rejected: status history was malformed.`)
  return h.map(([ts, from, to]) => [ts, from, to])
}

/**
 * The history answer for a batch -> Map(key -> status changes). Every requested key must come back exactly once:
 * a skipped ticket is an error, never an empty history, and an unrequested key is an error too.
 */
export function cleanHistory(list, expectedKeys) {
  const want = new Set(expectedKeys)
  const out = new Map()
  for (const e of list) {
    if (!e || typeof e.k !== 'string' || !want.has(e.k)) throw new JiraError('Claude returned history for a ticket that was not asked for.')
    if (out.has(e.k)) throw new JiraError(`Claude returned history for ${e.k} twice.`)
    out.set(e.k, cleanH(e.k, e.h))
  }
  const missing = expectedKeys.filter((k) => !out.has(k))
  if (missing.length) throw new JiraError(`Claude skipped the history for ${missing.length} ticket(s), so the saved data was left as it was.`)
  return out
}

/** Validates one row and keeps only the known fields. Throws if a row is malformed or carries an email address. */
export function cleanRow(raw) {
  if (!raw || typeof raw !== 'object') throw new JiraError('A ticket row from Claude was not an object.')
  if (typeof raw.k !== 'string' || !KEY.test(raw.k)) throw new JiraError('A ticket row from Claude had no valid key.')
  const k = raw.k
  const bad = (why) => new JiraError(`Ticket ${k} from Claude was rejected: ${why}.`)
  if (typeof raw.s !== 'string' || !raw.s) throw bad('no status')
  const c = stamp(raw.c)
  const u = stamp(raw.u)
  if (!c || !u) throw bad('missing created or updated date')
  const r = raw.r == null ? null : stamp(raw.r)
  if (raw.r != null && !r) throw bad('resolved date is not a date')
  const pair = Array.isArray(raw.pair) ? raw.pair : []
  if (!pair.every((p) => typeof p === 'string')) throw bad('Pair must be a list of names')
  const a = raw.a == null ? null : raw.a
  if (a !== null && typeof a !== 'string') throw bad('assignee must be a name')
  if ([a, ...pair, raw.t].some((v) => typeof v === 'string' && EMAIL.test(v))) throw bad('it contained an email address')
  const h = raw.h === undefined ? undefined : cleanH(k, raw.h)
  const row = {
    k, t: String(raw.t ?? '').replace(/\s+/g, ' ').trim(), s: raw.s, a, pair, c, u, r,
    y: strOrNull(raw.y), z: strOrNull(raw.z),
    d: typeof raw.d === 'string' && DATE.test(raw.d) ? raw.d.slice(0, 10) : null,
    sd: typeof raw.sd === 'string' && DATE.test(raw.sd) ? raw.sd.slice(0, 10) : null,
    rk: strOrNull(raw.rk),
  }
  if (h !== undefined) row.h = h
  return row
}

export const cleanRows = (list) => list.map(cleanRow)

// Display names of the custom fields in a slimmed search response (it keys them by name, not by ID). These are the names
// on this Jira site; config can override them with a fieldNames block.
export const DEFAULT_FIELD_NAMES = { pair: 'Pair', rank: 'Rank', size: 'T-Shirt Sizing', start: 'Start date' }

/** The responseFields that keep a search page to the few values we use: no emails, account IDs or descriptions. */
export function searchResponseFields(cfg) {
  const n = { ...DEFAULT_FIELD_NAMES, ...(cfg.fieldNames ?? {}) }
  return [
    'issues.key', 'issues.fields.summary', 'issues.fields.status.name', 'issues.fields.assignee.displayName',
    'issues.fields.created', 'issues.fields.updated', 'issues.fields.resolutiondate', 'issues.fields.issuetype.name', 'issues.fields.duedate',
    `issues.fields.customFields.${n.pair}.value.displayName`, `issues.fields.customFields.${n.rank}.value`,
    `issues.fields.customFields.${n.size}`, `issues.fields.customFields.${n.start}`,
    'nextPageToken', 'isLast',
  ]
}

/** Prompt: fetch ONE page of tickets for a JQL (no paging; the server pages by ticket key). Output only the JSON array. */
export function searchPrompt({ cloudId, jql, cfg, pageSize = 40 }) {
  const w = cfg.workload ?? {}
  const n = { ...DEFAULT_FIELD_NAMES, ...(cfg.fieldNames ?? {}) }
  const fields = ['summary', 'status', 'assignee', cfg.pairFieldId, 'created', 'updated', 'resolutiondate', 'issuetype', 'duedate', w.sizeFieldId, w.rankFieldId, w.startFieldId].filter(Boolean)
  return [
    'Read-only task. Use only executeRead; never create, edit or transition anything.',
    `Call executeRead ONCE with name "searchJiraIssuesUsingJql", cloudId "${cloudId}", responseFields ${JSON.stringify(searchResponseFields(cfg))}, and inputs { "jql": ${JSON.stringify(jql)}, "fields": ${JSON.stringify(fields)}, "maxResults": ${pageSize}, "view": "full" }.`,
    'The responseFields are required: they keep the page small. Do not fetch another page.',
    'Reply with ONLY a JSON array, no prose and no code fence. One object per ticket, in the order returned, with exactly these keys:',
    `k = key; t = fields.summary; s = fields.status.name; a = fields.assignee.displayName or null; pair = the displayName strings in customFields.${n.pair}.value (empty list if none);`,
    `c = fields.created; u = fields.updated; r = fields.resolutiondate or null; y = fields.issuetype.name; d = fields.duedate or null;`,
    `z = customFields["${n.size}"].value as a plain string, or null if there is no value; rk = customFields.${n.rank}.value or null; sd = customFields["${n.start}"].value as YYYY-MM-DD, or null if there is no value.`,
    'Copy values exactly and include every ticket on the page. Never include email addresses, account IDs or any other field.',
    'If the search returns no tickets, reply with []. If a call fails, reply with FAILED followed by one sentence saying which call failed and why, instead of a partial list.',
  ].join('\n')
}

/** Prompt: fetch the status history for a few tickets through the read-only changelog operation. */
export function historyPrompt({ cloudId, keys }) {
  return [
    'Read-only task. Use only executeRead; never write anything.',
    `For each of these issue keys call executeRead with name "listJiraIssueChangelogs", cloudId "${cloudId}", inputs { issueIdOrKey, startAt, maxResults 50 }, paging until all entries are read: ${keys.join(', ')}`,
    'Keep only changelog items where field is "status". Build [created, fromString, toString] for each, oldest first, using the entry timestamp.',
    'Reply with ONLY a JSON array, no prose and no code fence: one object per key, { "k": key, "h": [[timestamp, from, to], ...] }, with h an empty list when there is no status change.',
  ].join('\n')
}

/** Prompt: how many tickets does Jira say match? Used to catch a short answer from the row fetch. */
export function countPrompt({ cloudId, jql }) {
  return [
    'Read-only task. Use only executeRead.',
    `Call executeRead once with name "searchJiraIssuesUsingJql", cloudId "${cloudId}" and inputs { "jql": ${JSON.stringify(jql)}, "searchResultMode": "count" }.`,
    'Reply with ONLY a JSON array holding that one number, for example [42]. No prose, no code fence.',
  ].join('\n')
}

/** Validates a key-and-updated-time listing: [{ k, u }, ...]. Anything else in an entry is dropped. */
export function cleanKeyRows(list) {
  return list.map((e) => {
    if (!e || typeof e.k !== 'string' || !KEY.test(e.k)) throw new JiraError('A ticket in the key listing from Claude had no valid key.')
    if (!stamp(e.u)) throw new JiraError(`Ticket ${e.k} in the key listing from Claude had no usable updated time.`)
    return { k: e.k, u: e.u }
  })
}

/** Prompt: ONE page of just key and updated time (cheap), used to find tickets that moved or were removed. */
export function keysPrompt({ cloudId, jql, cfg, pageSize = 100 }) {
  return [
    'Read-only task. Use only executeRead; never create, edit or transition anything.',
    `Call executeRead ONCE with name "searchJiraIssuesUsingJql", cloudId "${cloudId}", responseFields ["issues.key","issues.fields.updated"], and inputs { "jql": ${JSON.stringify(jql)}, "fields": ["updated"], "maxResults": ${pageSize} }.`,
    'Do not fetch another page.',
    'Reply with ONLY a JSON array, no prose and no code fence: one object per ticket, in the order returned, { "k": key, "u": fields.updated }.',
    'Include every ticket on the page and nothing else. If the search returns no tickets, reply with []. If a call fails, reply with FAILED followed by one sentence saying which call failed and why.',
  ].join('\n')
}

/** Prompt: search Jira users by name. The responseFields keep only display name and active, so emails and IDs never reach Claude. */
export function userSearchPrompt({ cloudId, query }) {
  return [
    'Read-only task. Use only executeRead; never create, edit or transition anything.',
    `Call executeRead ONCE with name "lookupJiraAccountId", cloudId "${cloudId}", responseFields ["displayName","active"], and inputs { "query": ${JSON.stringify(query)}, "maxResults": 10 }.`,
    'Reply with ONLY a JSON array, no prose and no code fence: one object per person returned, in order, { "displayName": the display name, "active": true or false }.',
    'Never include email addresses or account IDs. If nobody matches, reply with []. If the call fails, reply with FAILED followed by one sentence saying why.',
  ].join('\n')
}

/** Display names of active people from a user search answer. Anything else is dropped; an email in a name is rejected. */
export function cleanPeople(list) {
  const out = []
  for (const p of list) {
    if (!p || typeof p.displayName !== 'string') throw new JiraError('A person in the search answer from Claude had no display name.')
    const name = p.displayName.replace(/\s+/g, ' ').trim()
    if (EMAIL.test(name)) throw new JiraError('The search answer from Claude contained an email address, so it was discarded.')
    if (p.active === true && name && !out.includes(name)) out.push(name)
  }
  return out.slice(0, 10)
}
