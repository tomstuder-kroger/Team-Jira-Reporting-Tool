import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PortfolioBars from './PortfolioBars.jsx'
import LabelList from './LabelList.jsx'
import KpiStrip from './KpiStrip.jsx'
import { BucketBadge } from './StatusBadge.jsx'
import { capacityRows, summarize, STATUS_LABEL } from '../lib/capacity.js'

// Synthetic only. Renders to HTML in node, so no browser is needed.
const Q = 'FY2026-Q4'
const PF = ['Portfolio A', 'Portfolio B']
const cap = {
  portfolios: PF,
  teams: ['Team One'],
  people: {
    'A, Ann': { teams: ['Team One', 'Team Two'], allocations: { [Q]: { 'Portfolio A': 60, 'Portfolio B': 30 } } },
    'B, Bo': { allocations: { [Q]: { 'Portfolio A': 70, 'Portfolio B': 50 } } },
    'C, Cy': {},
  },
}
const rows = capacityRows(['A, Ann', 'B, Bo', 'C, Cy'], cap, Q)

describe('PortfolioBars', () => {
  it('writes the weeks beside every bar and scales to the largest', () => {
    const s = summarize(rows, PF, ['Team One'])
    const html = renderToStaticMarkup(<PortfolioBars rows={s.perPortfolio} />)
    for (const r of s.perPortfolio) expect(html).toContain(`${r.weeks} wk`)
    expect(html).toContain('width:100%') // the largest portfolio fills the bar
    expect(html).not.toContain('NaN')
  })
  it('draws empty bars, not NaN, when nothing is planned, and a hint when there are no portfolios', () => {
    expect(renderToStaticMarkup(<PortfolioBars rows={[{ portfolio: 'X', weeks: 0 }]} />)).toContain('width:0%')
    expect(renderToStaticMarkup(<PortfolioBars rows={[]} />)).toContain('Add a portfolio')
  })
})

describe('status wording for each person', () => {
  it('says over by how much, fully allocated with the free share, and not planned for nobody', () => {
    const [ann, bo, cy] = rows
    expect([ann.status, bo.status, cy.status]).toEqual(['fully', 'over', 'none'])
    expect([ann.unallocated, bo.over]).toEqual([10, 20])
    expect(STATUS_LABEL.over).toBe('Over')
    expect(renderToStaticMarkup(<BucketBadge bucket="blocked">Over by {bo.over}%</BucketBadge>)).toContain('Over by 20%')
  })
})

describe('summary tiles', () => {
  it('render team utilization and counts, colouring only an overloaded team', () => {
    const s = summarize(rows, PF, ['Team One'])
    const html = renderToStaticMarkup(<KpiStrip kpis={[{ id: 'util', value: `${s.utilization}%`, label: 'Team utilization', hint: '', tone: s.utilization > 100 ? 'destructive' : undefined }, { id: 'over', value: s.over, label: 'Over 100%', hint: '' }]} />)
    expect(html).toContain(`${s.utilization}%`)
    expect(html).not.toContain('NaN')
  })
})

describe('LabelList', () => {
  const render = (items) => renderToStaticMarkup(<LabelList title="Portfolios" noun="portfolio" items={items} onAdd={() => {}} onRename={() => {}} onRemove={() => {}} />)
  it('lists each name with Rename and Remove buttons named for it, and an add box', () => {
    const html = render(['Portfolio A', 'Portfolio B'])
    expect(html).toContain('Portfolios (2)')
    expect(html).toContain('aria-label="Rename Portfolio A"')
    expect(html).toContain('aria-label="Remove Portfolio B"')
    expect(html).toContain('aria-label="New portfolio name"')
  })
  it('says there are none yet', () => {
    expect(render([])).toContain('No portfolios yet.')
  })
})
