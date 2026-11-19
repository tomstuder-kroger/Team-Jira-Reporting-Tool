import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RefreshBanner from './RefreshBanner.jsx'

const html = (props) => renderToStaticMarkup(<RefreshBanner {...props} />)

describe('RefreshBanner', () => {
  it('names what is happening and gives the step in words', () => {
    const h = html({ progress: { phase: 'history', done: 70, total: 120, costUsd: 1.2, maxUsd: 5 }, startedAt: Date.now() - 125500 })
    expect(h).toContain('Refreshing from Jira')
    expect(h).toContain('Reading status history: 70 of 120 changed tickets.')
    expect(h).toContain('role="status"')
  })
  it('fills the bar when the length is known, and exposes it to screen readers', () => {
    const h = html({ progress: { phase: 'history', done: 60, total: 120 } })
    expect(h).toContain('role="progressbar"')
    expect(h).toContain('aria-valuenow="50"')
    expect(h).toContain('width:50%')
    expect(h).not.toContain('dar-indeterminate')
  })
  it('slides an indeterminate bar, with no value, when the length is not known', () => {
    const h = html({ progress: { phase: 'check' } })
    expect(h).toContain('dar-indeterminate')
    expect(h).not.toContain('aria-valuenow')
    expect(h).toContain('aria-valuetext="in progress"')
  })
  it('shows elapsed time and spend against the limit', () => {
    const h = html({ progress: { phase: 'tickets', done: 1, total: 6, rows: 40, costUsd: 1.2, maxUsd: 5 }, startedAt: Date.now() - 125500 })
    expect(h).toContain('2:05 elapsed')
    expect(h).toContain('$1.20 of $5.00 limit')
  })
  it('omits elapsed and spend until they are known, and still renders at the very start', () => {
    const h = html({ progress: null, startedAt: null })
    expect(h).toContain('Starting the refresh…')
    expect(h).not.toContain('elapsed')
    expect(h).not.toContain('limit')
  })
  it('sticks below the sticky header, and does not animate for people who ask for less motion', () => {
    const h = html({ progress: null })
    expect(h).toContain('sticky top-16')
    expect(h).toContain('motion-reduce:animate-none')
  })
})
