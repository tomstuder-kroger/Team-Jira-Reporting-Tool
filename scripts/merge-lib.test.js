import { describe, it, expect } from 'vitest'
import { mergeReport, DATA_VERSION } from './merge-lib.mjs'

const config = {
  siteUrl: 'https://example.atlassian.net', historyDays: 120, defaultBucket: 'open',
  statusBuckets: { Open: 'open', Closed: 'closed' },
  roster: [{ jiraName: 'A, Ann' }, { jiraName: 'B, Bo' }],
}
const NOW = '2026-11-04T15:00:00.000Z'
const row = (over = {}) => ({ k: 'X-1', t: 'a', s: 'Open', a: 'A, Ann', pair: [], c: '2026-10-01T12:00:00.000-0400', u: '2026-11-03T09:30:00.000-0500', r: null, ...over })
const run = (pool = [], over = {}) => mergeReport({ pool, config, now: NOW, ...over })

describe('mergeReport', () => {
  it('stamps the version, pull time and history window', () => {
    const { data } = run()
    expect(data.version).toBe(DATA_VERSION)
    expect(data.meta).toMatchObject({ pulledAt: NOW, historyDays: 120, source: 'example.atlassian.net' })
    expect(data.meta.historyStart).toBe('2026-07-07T15:00:00.000Z')
  })

  it('rejects a missing or invalid pull time', () => {
    expect(() => mergeReport({ pool: [], config })).toThrow(/valid "now"/)
    expect(() => mergeReport({ pool: [], config, now: 'not a date' })).toThrow(/valid "now"/)
  })

  it('normalises Jira timestamps to UTC and keeps resolved as null while open', () => {
    const { data } = run([row({ k: 'X-1' }), row({ k: 'X-2', s: 'Closed', r: '2026-10-30T08:00:00.000-0400' })])
    expect(data.tickets[0]).toMatchObject({ c: '2026-10-01T16:00:00.000Z', u: '2026-11-03T14:30:00.000Z', r: null })
    expect(data.tickets[1].r).toBe('2026-10-30T12:00:00.000Z')
  })

  it('drops tickets with nobody on the roster and warns', () => {
    const { data, warnings } = run([row({ k: 'X-9', a: 'Z, Zed', pair: ['Y, Yo'] })])
    expect(data.tickets).toHaveLength(0)
    expect(warnings.join(' ')).toMatch(/X-9 is not assigned to or paired with anyone on the roster/)
  })

  it('keeps a ticket assigned to a non-designer when a designer is paired', () => {
    const { data } = run([row({ k: 'X-3', a: 'Dev, Dee', pair: ['B, Bo'] })])
    expect(data.tickets[0]).toMatchObject({ k: 'X-3', a: 'Dev, Dee', pair: ['B, Bo'] })
  })

  it('drops a ticket with no usable updated date, because it cannot be placed in a range', () => {
    const { data, warnings } = run([row({ k: 'X-5', u: null }), row({ k: 'X-6', u: 'garbage' })])
    expect(data.tickets).toHaveLength(0)
    expect(warnings.filter((w) => /no usable updated date/.test(w))).toHaveLength(2)
  })

  it('warns about a status that is not mapped, and about duplicates', () => {
    const t = row({ k: 'X-4', s: 'Waiting on Vendor' })
    const { data, warnings } = run([t, t])
    expect(data.tickets).toHaveLength(1)
    expect(warnings.join(' ')).toMatch(/"Waiting on Vendor".*not in statusBuckets/)
    expect(warnings.join(' ')).toMatch(/Duplicate ticket X-4/)
  })

  it('de-duplicates Pair names and treats a missing created date as null', () => {
    const { data } = run([row({ pair: ['B, Bo', 'B, Bo'], c: undefined })])
    expect(data.tickets[0].pair).toEqual(['B, Bo'])
    expect(data.tickets[0].c).toBeNull()
  })

  it('keeps status history sorted, in UTC, and drops malformed entries', () => {
    const { data } = run([row({ h: [
      ['2026-10-20T10:00:00.000-0400', 'In Progress', 'Blocked'],
      ['2026-10-10T10:00:00.000-0400', 'Open', 'In Progress'],
      ['not a date', 'a', 'b'],
      ['2026-10-25T10:00:00.000Z', 'Blocked'],
      null,
    ] })])
    expect(data.tickets[0].h).toEqual([
      ['2026-10-10T14:00:00.000Z', 'Open', 'In Progress'],
      ['2026-10-20T14:00:00.000Z', 'In Progress', 'Blocked'],
    ])
  })

  it('gives an empty history when none was supplied, and drops history with non-roster tickets', () => {
    const { data } = run([row(), row({ k: 'X-2', a: 'Dev, Dee', pair: [], h: [['2026-10-10T10:00:00.000Z', 'Open', 'Blocked']] })])
    expect(data.tickets).toHaveLength(1)
    expect(data.tickets[0].h).toEqual([])
  })
})

describe('mergeReport, workload fields (version 4)', () => {
  const wcfg = { ...config, workload: { sizeFieldId: 'customfield_1', rankFieldId: 'customfield_2', sizeDays: { SM: 5, MED: 10 } } }
  const runW = (pool) => mergeReport({ pool, config: wcfg, now: NOW })

  it('writes version 4', () => {
    expect(DATA_VERSION).toBe(4)
    expect(run().data.version).toBe(4)
  })

  it('keeps issue type, size, due date and rank, and nulls anything missing or malformed', () => {
    const { data } = run([
      row({ k: 'X-1', y: 'Story', z: 'SM', d: '2026-12-02', rk: '0|hzzzzz:' }),
      row({ k: 'X-2' }),
      row({ k: 'X-3', y: '', z: 5, d: 'soon', rk: 7 }),
      row({ k: 'X-4', d: '2026-12-02T09:00:00.000-0500' }),
      row({ k: 'X-5', sd: '2026-11-03' }),
      row({ k: 'X-6', sd: 'next week' }),
    ])
    const by = Object.fromEntries(data.tickets.map((t) => [t.k, t]))
    expect(by['X-1']).toMatchObject({ y: 'Story', z: 'SM', d: '2026-12-02', rk: '0|hzzzzz:' })
    expect(by['X-2']).toMatchObject({ y: null, z: null, d: null, rk: null })
    expect(by['X-3']).toMatchObject({ y: null, z: null, d: null, rk: null })
    expect(by['X-4'].d).toBe('2026-12-02')
    expect(by['X-5'].sd).toBe('2026-11-03')
    expect(by['X-6'].sd).toBeNull()
    expect(by['X-1'].sd).toBeNull()
  })

  it('warns once about an open ticket whose size is not in sizeDays, and not about known sizes', () => {
    const { warnings } = runW([row({ k: 'X-1', z: 'XXL' }), row({ k: 'X-2', z: 'SM' }), row({ k: 'X-3', z: null })])
    const w = warnings.filter((m) => /size/.test(m))
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/X-1 has size "XXL"/)
  })

  it('does not warn about the size of a closed ticket, or when there is no workload block', () => {
    expect(runW([row({ k: 'X-1', z: 'XXL', s: 'Closed', r: '2026-10-30T08:00:00.000-0400' })]).warnings.filter((m) => /size/.test(m))).toHaveLength(0)
    expect(run([row({ k: 'X-1', z: 'XXL' })]).warnings.filter((m) => /size/.test(m))).toHaveLength(0)
  })

  it('uses the default sizes when the block does not list any', () => {
    const c = { ...config, workload: { sizeFieldId: 'customfield_1', rankFieldId: 'customfield_2' } }
    const { warnings } = mergeReport({ pool: [row({ k: 'X-1', z: 'LG' }), row({ k: 'X-2', z: 'XXL' })], config: c, now: NOW })
    expect(warnings.filter((m) => /size/.test(m)).join(' ')).toMatch(/X-2/)
    expect(warnings.join(' ')).not.toMatch(/X-1 has size/)
  })
})

