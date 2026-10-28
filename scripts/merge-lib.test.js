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
