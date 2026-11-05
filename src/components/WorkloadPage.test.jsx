import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorkloadPage from './WorkloadPage.jsx'
import cfg from '../../config/report.config.example.json'

// Synthetic only: the fake example config, made-up tickets. Renders to HTML in node, no browser needed.
const tk = (k, o = {}) => ({ k, t: 'Task', s: 'In Progress', a: 'Doe, Jamie', pair: [], c: '2026-10-01T00:00:00Z', u: '2026-10-20T00:00:00Z', r: null, h: [], y: 'Story', z: null, d: null, rk: null, ...o })
const data = (tickets, version = 4) => ({ version, meta: { pulledAt: '2026-10-30T12:00:00Z' }, tickets })
const html = (d, c = cfg) => renderToStaticMarkup(<WorkloadPage data={d} cfg={c} />)

describe('WorkloadPage', () => {
  it('lists every roster member, including people with nothing open', () => {
    const h = html(data([tk('ABC-1', { z: 'SM' })]))
    for (const name of ['Jamie Doe', 'Alex Roe', 'Sam Poe']) expect(h).toContain(name)
    expect(h).toContain('No open work')
  })

  it('shows the coverage banner when fewer than half of open tickets are sized', () => {
    const h = html(data([tk('ABC-1'), tk('ABC-2'), tk('ABC-3', { z: 'SM' })]))
    expect(h).toContain('Most open work has no T-shirt size')
    expect(h).toContain('Only 1 of 3 open tickets')
    expect(h).toContain('No open work') // others
  })

  it('hides the banner when most tickets are sized, and when there are none', () => {
    expect(html(data([tk('ABC-1', { z: 'SM' }), tk('ABC-2', { z: 'MED' })]))).not.toContain('Most open work has no T-shirt size')
    expect(html(data([]))).not.toContain('Most open work has no T-shirt size')
  })

  it('shows "no sized work" for someone with only unsized tickets, never 0%', () => {
    const h = html(data([tk('ABC-1')]))
    expect(h).toContain('No sized work')
    expect(h).toContain('1 unsized')
  })

  it('asks for a refresh on a version 3 file', () => {
    expect(html(data([], 3))).toContain('Refresh from Jira to load sizes and ranks')
  })

  it('says it is not set up when the workload block is missing or wrong', () => {
    const { workload, ...bare } = cfg
    expect(html(data([]), bare)).toContain('Workload is not set up')
    expect(html(data([]), { ...cfg, workload: { ...workload, focus: 5 } })).toContain('workload.focus')
  })

  it('shows a loading note before the data arrives', () => {
    expect(renderToStaticMarkup(<WorkloadPage data={null} cfg={cfg} />)).toContain('Loading')
  })

  it('offers this week, next week, next 2 weeks, this quarter and next quarter in grouped choices', () => {
    const h = html(data([tk('ABC-1', { z: 'SM' })]))
    for (const text of ['Next 2 weeks', 'This week', 'Next week', 'This quarter', 'Next quarter']) expect(h).toContain(text)
    for (const group of ['Rolling, from today', 'Calendar', 'Fiscal']) expect(h).toContain(`label="${group}"`)
  })

  it('states what is not included', () => {
    const h = html(data([tk('ABC-1', { z: 'SM' })]))
    expect(h).toContain('Time off is not included')
    expect(h).toContain('Epics are left out')
  })
})
