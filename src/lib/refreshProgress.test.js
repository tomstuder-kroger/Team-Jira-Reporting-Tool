import { describe, it, expect } from 'vitest'
import { describeProgress, formatElapsed, formatSpend } from './refreshProgress.js'

describe('describeProgress', () => {
  it('says it is starting before the server has reported anything', () => {
    expect(describeProgress(null)).toEqual({ text: 'Starting the refresh…', fraction: null })
  })
  it('counts tickets read and projects finished, and fills by projects', () => {
    const r = describeProgress({ phase: 'tickets', done: 2, total: 6, rows: 188 })
    expect(r.text).toBe('Reading tickets: 188 read so far, 2 of 6 projects finished.')
    expect(r.fraction).toBeCloseTo(1 / 3, 5)
  })
  it('shows an unknown length for the count check and the reconcile', () => {
    expect(describeProgress({ phase: 'check' }).fraction).toBeNull()
    expect(describeProgress({ phase: 'reconcile', done: 0, total: 6 }).fraction).toBeNull()
    expect(describeProgress({ phase: 'reconcile' }).text).toMatch(/moved or were removed/)
  })
  it('fills by tickets during the history step, never past full', () => {
    expect(describeProgress({ phase: 'history', done: 70, total: 120 })).toEqual({ text: 'Reading status history: 70 of 120 changed tickets.', fraction: 70 / 120 })
    expect(describeProgress({ phase: 'history', done: 130, total: 120 }).fraction).toBe(1)
  })
  it('describes reading the changed tickets, and none changed', () => {
    expect(describeProgress({ phase: 'changed', done: 3, total: 12 })).toEqual({ text: 'Reading 12 changed or new tickets: 3 done.', fraction: 0.25 })
    expect(describeProgress({ phase: 'changed', done: 0, total: 0 })).toEqual({ text: 'No tickets have changed.', fraction: 1 })
  })
  it('handles nothing to re-read and an unknown phase', () => {
    expect(describeProgress({ phase: 'history', done: 0, total: 0 })).toEqual({ text: 'No status history needs re-reading.', fraction: 1 })
    expect(describeProgress({ phase: 'something new' }).fraction).toBeNull()
  })
})

describe('formatElapsed', () => {
  it('formats minutes and seconds, and hours when needed', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(7400)).toBe('0:07')
    expect(formatElapsed(161000)).toBe('2:41')
    expect(formatElapsed(3723000)).toBe('1:02:03')
    expect(formatElapsed(-5000)).toBe('0:00')
  })
})

describe('formatSpend', () => {
  it('shows cost against the limit, and nothing before a cost is known', () => {
    expect(formatSpend({ costUsd: 1.2, maxUsd: 5 })).toBe('$1.20 of $5.00 limit')
    expect(formatSpend({ costUsd: 0, maxUsd: 5 })).toBe('$0.00 of $5.00 limit')
    expect(formatSpend({ costUsd: 2 })).toBe('$2.00')
    expect(formatSpend({ phase: 'check' })).toBeNull()
    expect(formatSpend(null)).toBeNull()
  })
})
