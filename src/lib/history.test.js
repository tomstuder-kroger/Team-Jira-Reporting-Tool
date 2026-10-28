import { describe, it, expect } from 'vitest'
import { statusAt, statusAtEnd, hasActivity, openAtEnd, inRange } from './history.js'

// Synthetic only. Local-time dates so the tests hold in any time zone.
const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).toISOString()
const ms = (m, d, h = 12) => new Date(at(m, d, h)).getTime()
const T = (over = {}) => ({ k: 'EX-1', s: 'Closed', c: at(10, 1), r: at(10, 20), h: [[at(10, 5), 'Open', 'In Progress'], [at(10, 12), 'In Progress', 'Blocked'], [at(10, 20), 'Blocked', 'Closed']], ...over })

describe('statusAt', () => {
  it('uses the from-status before the first change, the to-status after each change, and the exact change time counts', () => {
    expect(statusAt(T(), ms(10, 2))).toBe('Open')
    expect(statusAt(T(), ms(10, 5))).toBe('In Progress')
    expect(statusAt(T(), ms(10, 11))).toBe('In Progress')
    expect(statusAt(T(), ms(10, 15))).toBe('Blocked')
    expect(statusAt(T(), ms(10, 25))).toBe('Closed')
  })
  it('gives the current status when there is no history, and null before the ticket existed', () => {
    expect(statusAt(T({ h: [], s: 'Open', r: null }), ms(10, 10))).toBe('Open')
    expect(statusAt(T(), ms(9, 1))).toBeNull()
    expect(statusAt(T({ h: undefined, s: 'Open', r: null }), ms(10, 10))).toBe('Open')
  })
})

describe('statusAtEnd', () => {
  it('judges a window by its last instant, and uses the current status for a window that ends at the pull', () => {
    const pull = ms(11, 4)
    expect(statusAtEnd(T(), ms(10, 12), pull)).toBe('In Progress') // end is exclusive, so a change exactly at the end is not included
    expect(statusAtEnd(T(), ms(10, 13), pull)).toBe('Blocked')
    expect(statusAtEnd(T({ s: 'Reopened' }), pull, pull)).toBe('Reopened')
  })
})

describe('hasActivity', () => {
  it('counts created, resolved and status changes, with start inclusive and end exclusive', () => {
    expect(hasActivity(T(), ms(10, 1), ms(10, 2))).toBe(true) // created
    expect(hasActivity(T(), ms(10, 6), ms(10, 13))).toBe(true) // status change Oct 12
    expect(hasActivity(T(), ms(10, 20), ms(10, 21))).toBe(true) // resolved
    expect(hasActivity(T(), ms(10, 6), ms(10, 12))).toBe(false) // change exactly at the end is out
    expect(hasActivity(T(), ms(10, 13), ms(10, 19))).toBe(false)
    expect(hasActivity(T({ h: undefined, r: null }), ms(10, 6), ms(10, 13))).toBe(false)
  })
})

describe('openAtEnd', () => {
  it('is true from creation until resolution', () => {
    expect(openAtEnd(T(), ms(9, 30))).toBe(false) // not created yet
    expect(openAtEnd(T(), ms(10, 10))).toBe(true)
    expect(openAtEnd(T(), ms(10, 25))).toBe(false) // resolved
    expect(openAtEnd(T({ r: null }), ms(12, 1))).toBe(true)
  })
})

describe('inRange', () => {
  it('handles missing values', () => {
    expect(inRange(null, 0, 10)).toBe(false)
    expect(inRange(at(10, 5), ms(10, 5), ms(10, 6))).toBe(true)
  })
})
