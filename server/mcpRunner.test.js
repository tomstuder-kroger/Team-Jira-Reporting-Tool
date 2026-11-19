import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import cfg from '../config/report.config.example.json'
import { ALLOWED_TOOLS, DENIED_TOOLS, buildClaudeArgs, runClaude, extractJsonArray, cleanRow, cleanRows, searchPrompt, historyPrompt, countPrompt, searchResponseFields, emptyWorkDir, userSearchPrompt, cleanPeople, cleanKeyRows, keysPrompt } from './mcpRunner.mjs'
import { JiraError, SetupError } from './errors.mjs'

const CLOUD = '00000000-0000-4000-8000-000000000000'

// A stand-in for the claude process: emits `out` on stdout, then closes.
const fakeSpawn = (out, { code = 0, error, hang } = {}) => vi.fn(() => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.kill = vi.fn()
  queueMicrotask(() => {
    if (hang) return
    if (error) return child.emit('error', error)
    child.stdout.emit('data', out)
    child.emit('close', code)
  })
  return child
})
const envelope = (result, extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, ...extra })

describe('buildClaudeArgs', () => {
  const args = buildClaudeArgs({ prompt: 'p' })
  const after = (flag) => args[args.indexOf(flag) + 1]
  it('allows only the read tools and denies every write tool, Bash and file writes', () => {
    expect(after('--allowedTools').split(',')).toEqual(ALLOWED_TOOLS)
    expect(ALLOWED_TOOLS).toEqual(['mcp__atlassian__executeRead'])
    for (const t of ['mcp__atlassian__searchJiraIssuesUsingJql', 'mcp__atlassian__executeWrite', 'mcp__atlassian__executeDestructive', 'mcp__atlassian__createJiraIssue', 'mcp__atlassian__editJiraIssue', 'mcp__atlassian__transitionJiraIssue', 'Bash', 'Write', 'Edit']) {
      expect(after('--disallowedTools').split(',')).toContain(t)
    }
  })
  it('never allows a tool it also denies', () => {
    expect(ALLOWED_TOOLS.filter((t) => DENIED_TOOLS.includes(t))).toEqual([])
  })
  it('caps spending and asks for JSON without saving a session', () => {
    expect(after('--max-budget-usd')).toBe('2')
    expect(after('--output-format')).toBe('json')
    expect(args).toContain('--no-session-persistence')
    expect(after('--max-budget-usd')).not.toBe('')
    expect(buildClaudeArgs({ prompt: 'p', maxBudgetUsd: 5 })).toContain('5')
  })
})

describe('lean launch', () => {
  const args = buildClaudeArgs({ prompt: 'p' })
  const after = (flag) => args[args.indexOf(flag) + 1]
  it('loads only the Atlassian server, user settings, no skills and no built-in tools', () => {
    expect(args).toContain('--strict-mcp-config')
    expect(JSON.parse(after('--mcp-config'))).toEqual({ mcpServers: { atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp' } } })
    expect(after('--setting-sources')).toBe('user')
    expect(args).toContain('--disable-slash-commands')
    expect(after('--tools')).toBe('')
    expect(after('--system-prompt')).toMatch(/read-only data relay/)
  })
  it('adds --model only when one is asked for', () => {
    expect(buildClaudeArgs({ prompt: 'p' })).not.toContain('--model')
    const a = buildClaudeArgs({ prompt: 'p', model: 'haiku' })
    expect(a[a.indexOf('--model') + 1]).toBe('haiku')
  })
  it('runs in an empty folder so no project instructions are loaded', () => {
    const dir = emptyWorkDir()
    expect(fs.readdirSync(dir)).toEqual([])
    expect(dir.startsWith(os.tmpdir())).toBe(true)
    const spawnImpl = fakeSpawn(envelope('[1]'))
    return runClaude({ prompt: 'p', spawnImpl }).then(() => expect(spawnImpl.mock.calls[0][2].cwd).toBe(dir))
  })
})

describe('runClaude', () => {
  it('returns the final answer text', async () => {
    expect(await runClaude({ prompt: 'p', spawnImpl: fakeSpawn(envelope('[1]')) })).toBe('[1]')
  })
  it('turns a failed run into a plain error and leaks no output', async () => {
    const run = runClaude({ prompt: 'p', spawnImpl: fakeSpawn(JSON.stringify({ is_error: true, subtype: 'error_during_execution', result: 'SECRET-DETAIL' })) })
    await expect(run).rejects.toBeInstanceOf(JiraError)
    await expect(run).rejects.not.toThrow(/SECRET-DETAIL/)
  })
  it('says when the spending limit was hit', async () => {
    await expect(runClaude({ prompt: 'p', spawnImpl: fakeSpawn(JSON.stringify({ is_error: true, subtype: 'error_max_budget_usd' })) })).rejects.toThrow(/spending limit/)
  })
  it('reports unreadable output', async () => {
    await expect(runClaude({ prompt: 'p', spawnImpl: fakeSpawn('not json', { code: 1 }) })).rejects.toThrow(/unreadable/)
  })
  it('explains a missing claude command as a setup problem', async () => {
    await expect(runClaude({ prompt: 'p', spawnImpl: fakeSpawn('', { error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) })).rejects.toBeInstanceOf(SetupError)
  })
  it('stops a run that takes too long', async () => {
    const spawnImpl = fakeSpawn('', { hang: true })
    await expect(runClaude({ prompt: 'p', spawnImpl, timeoutMs: 20 })).rejects.toThrow(/too long/)
    expect(spawnImpl.mock.results[0].value.kill).toHaveBeenCalled()
  })
})

describe('extractJsonArray', () => {
  it('reads a bare array and one inside a code fence', () => {
    expect(extractJsonArray('[{"k":"ABC-1"}]')).toEqual([{ k: 'ABC-1' }])
    expect(extractJsonArray('```json\n[{"k":"ABC-1"}]\n```')).toEqual([{ k: 'ABC-1' }])
  })
  it('rejects text without a list, and broken JSON', () => {
    expect(() => extractJsonArray('I could not find anything')).toThrow(JiraError)
    expect(() => extractJsonArray('[{"k": ')).toThrow(JiraError)
  })
})

describe('cleanRow', () => {
  const good = { k: 'ABC-123', t: '  Fix   the\nthing ', s: 'In Progress', a: 'Doe, Jamie', pair: ['Roe, Alex'], c: '2026-10-01T10:00:00.000-0400', u: '2026-10-27T09:00:00.000-0400', r: null, y: 'Story', z: 'SM', d: '2026-11-30', sd: '2026-11-02', rk: '0|abc:' }
  it('keeps the known fields and tidies the title', () => {
    expect(cleanRow(good)).toEqual({ ...good, t: 'Fix the thing' })
  })
  it('drops anything not in the row shape, such as account IDs', () => {
    const row = cleanRow({ ...good, accountId: '712020:xyz', extra: { emailAddress: 'a@b.com' } })
    expect(Object.keys(row).sort()).toEqual(['a', 'c', 'd', 'k', 'pair', 'r', 'rk', 's', 'sd', 't', 'u', 'y', 'z'])
  })
  it('turns empty optional values into null', () => {
    const row = cleanRow({ ...good, y: '', z: undefined, d: 'soon', sd: null, rk: '' })
    expect([row.y, row.z, row.d, row.sd, row.rk]).toEqual([null, null, null, null, null])
  })
  it('rejects an email address in the assignee, Pair or title', () => {
    expect(() => cleanRow({ ...good, a: 'jamie.doe@example.com' })).toThrow(/email/)
    expect(() => cleanRow({ ...good, pair: ['alex@example.com'] })).toThrow(/email/)
    expect(() => cleanRow({ ...good, t: 'mail jamie@example.com' })).toThrow(/email/)
  })
  it('rejects a bad key, missing status, bad dates and a Pair that is not names', () => {
    expect(() => cleanRow({ ...good, k: 'nope' })).toThrow(/valid key/)
    expect(() => cleanRow({ ...good, s: '' })).toThrow(/status/)
    expect(() => cleanRow({ ...good, c: null })).toThrow(/created or updated/)
    expect(() => cleanRow({ ...good, r: 'yesterday' })).toThrow(/resolved/)
    expect(() => cleanRow({ ...good, pair: [{ displayName: 'Roe, Alex' }] })).toThrow(/Pair/)
    expect(() => cleanRow(null)).toThrow(JiraError)
  })
  it('validates status history when it is present and leaves it out when it is not', () => {
    expect('h' in cleanRow(good)).toBe(false)
    const h = [['2026-10-05T10:00:00.000-0400', 'Open', 'In Progress']]
    expect(cleanRow({ ...good, h }).h).toEqual(h)
    expect(() => cleanRow({ ...good, h: [['2026-10-05T10:00:00.000-0400', 'Open']] })).toThrow(/history/)
    expect(() => cleanRow({ ...good, h: [['not a date', 'Open', 'Done']] })).toThrow(/history/)
  })
  it('cleanRows fails the whole list on one bad row', () => {
    expect(() => cleanRows([good, { ...good, k: 'bad' }])).toThrow(JiraError)
  })
})

describe('prompts', () => {
  it('search prompt names the site, query and fields, and forbids emails and writes', () => {
    const p = searchPrompt({ cloudId: CLOUD, jql: 'project = ABC', cfg })
    expect(p).toContain(CLOUD)
    expect(p).toContain('project = ABC')
    expect(p).toContain(cfg.pairFieldId)
    expect(p).toMatch(/Never include email addresses/)
    expect(p).toMatch(/never create, edit or transition/)
  })
  it('search goes through executeRead with slimming responseFields, so emails and account IDs never reach Claude', () => {
    const p = searchPrompt({ cloudId: CLOUD, jql: 'project = ABC', cfg })
    expect(p).toContain('Call executeRead ONCE with name "searchJiraIssuesUsingJql"')
    expect(p).toContain('"maxResults": 40')
    expect(p).toMatch(/Do not fetch another page/)
    const fields = searchResponseFields(cfg)
    expect(fields).toContain('issues.fields.customFields.Pair.value.displayName') // names only, not the whole person
    expect(fields.some((f) => /email|accountId|description/i.test(f))).toBe(false)
    expect(fields.some((f) => f === 'issues.fields.customFields.Pair')).toBe(false)
    for (const f of fields) expect(p).toContain(f)
  })
  it('custom field display names can be overridden in config', () => {
    const fields = searchResponseFields({ ...cfg, fieldNames: { pair: 'Buddy' } })
    expect(fields).toContain('issues.fields.customFields.Buddy.value.displayName')
    expect(fields).toContain('issues.fields.customFields.Rank.value')
  })
  it('asks for FAILED rather than a partial list, and the count prompt uses executeRead in count mode', () => {
    expect(searchPrompt({ cloudId: CLOUD, jql: 'x', cfg })).toMatch(/FAILED/)
    const c = countPrompt({ cloudId: CLOUD, jql: 'project = ABC' })
    expect(c).toContain('"searchResultMode": "count"')
    expect(c).toContain('executeRead')
  })
  it('history prompt lists the keys and uses only the read operation', () => {
    const p = historyPrompt({ cloudId: CLOUD, keys: ['ABC-1', 'ABC-2'] })
    expect(p).toContain('ABC-1, ABC-2')
    expect(p).toContain('listJiraIssueChangelogs')
    expect(p).toMatch(/never write/)
  })
})

describe('user search', () => {
  it('asks for display name and active only, through executeRead', () => {
    const p = userSearchPrompt({ cloudId: CLOUD, query: 'ryan "x"' })
    expect(p).toContain('name "lookupJiraAccountId"')
    expect(p).toContain('responseFields ["displayName","active"]')
    expect(p).toContain('"query": "ryan \\"x\\""') // the typed text is quoted, not pasted in raw
    expect(p).toMatch(/Never include email addresses or account IDs/)
  })
  it('keeps active people by display name, drops duplicates and anything else', () => {
    expect(cleanPeople([
      { displayName: 'Doe, Jamie', active: true, accountId: '712020:xyz' },
      { displayName: 'Doe,   Jamie', active: true },
      { displayName: 'Gone, Pat', active: false },
      { displayName: 'Roe, Alex (NonEmp)', active: true },
    ])).toEqual(['Doe, Jamie', 'Roe, Alex (NonEmp)'])
  })
  it('rejects an answer that carries an email address or no name', () => {
    expect(() => cleanPeople([{ displayName: 'jamie.doe@example.com', active: true }])).toThrow(/email/)
    expect(() => cleanPeople([{ active: true }])).toThrow(JiraError)
  })
  it('limits the list to ten', () => {
    expect(cleanPeople(Array.from({ length: 15 }, (_, i) => ({ displayName: `P, ${i}`, active: true })))).toHaveLength(10)
  })
})

describe('key listing', () => {
  it('asks for key and updated time only', () => {
    const p = keysPrompt({ cloudId: CLOUD, jql: 'project = ABC', cfg })
    expect(p).toContain('responseFields ["issues.key","issues.fields.updated"]')
    expect(p).toContain('"maxResults": 100')
  })
  it('validates entries and drops other fields', () => {
    expect(cleanKeyRows([{ k: 'ABC-1', u: '2026-11-10T09:00:00.000-0500', extra: 1 }])).toEqual([{ k: 'ABC-1', u: '2026-11-10T09:00:00.000-0500' }])
    expect(() => cleanKeyRows([{ k: 'nope', u: '2026-11-10T09:00:00.000-0500' }])).toThrow(JiraError)
    expect(() => cleanKeyRows([{ k: 'ABC-1', u: 'soon' }])).toThrow(JiraError)
  })
})
