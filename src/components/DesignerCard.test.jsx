import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DesignerCard from './DesignerCard.jsx'

// Synthetic only. Renders to HTML in node, so no browser is needed.
const d = {
  name: 'Doe, Jamie A',
  own: [{ k: 'EX-1', t: 'First ticket', s: 'Closed' }, { k: 'EX-2', t: 'Second ticket', s: 'In Progress' }],
  pair: [{ k: 'EX-3', t: 'Paired ticket', s: 'PM Review', a: 'Roe, Alex' }],
  idle: [],
  week: [{ k: 'EX-1', s: 'Closed' }, { k: 'EX-2', s: 'In Progress' }, { k: 'EX-3', s: 'PM Review' }],
  active: true,
  note: 'Activity in the last 7 days: 1 closed.',
}
const html = (props) => renderToStaticMarkup(<DesignerCard d={d} {...props} />)

describe('DesignerCard', () => {
  it('always shows the name, assigned and paired counts, and the status badges', () => {
    for (const open of [true, false]) {
      const h = html({ open, onToggle() {} })
      expect(h).toContain('Jamie Doe')
      expect(h).toContain('2 assigned, 1 paired in this range')
      expect(h).toContain('1 Closed')
      expect(h).toContain('1 In Progress')
      expect(h).toContain('1 PM Review')
    }
  })

  it('puts the tickets and the note in a body that the hide control marks hidden, and the toggle reports its state', () => {
    const open = html({ open: true, onToggle() {} })
    const shut = html({ open: false, onToggle() {} })
    expect(open).toContain('aria-expanded="true"')
    expect(shut).toContain('aria-expanded="false"')
    expect(open).not.toMatch(/<div id="card-[^"]*" hidden/)
    expect(shut).toMatch(/<div id="card-[^"]*" hidden=""/)
    // the tickets sit inside that body, after the header
    expect(shut.indexOf('hidden=""')).toBeLessThan(shut.indexOf('First ticket'))
    expect(shut.indexOf('2 assigned, 1 paired')).toBeLessThan(shut.indexOf('hidden=""'))
  })

  it('names the button for screen readers and points it at the body it controls', () => {
    const h = html({ open: true, onToggle() {} })
    expect(h).toContain('aria-label="Hide tickets for Jamie Doe"')
    expect(html({ open: false, onToggle() {} })).toContain('aria-label="Show tickets for Jamie Doe"')
    const controls = /aria-controls="([^"]+)"/.exec(h)[1]
    expect(h).toContain(`id="${controls}"`)
  })

  it('is open by default, for places that do not pass the toggle', () => {
    expect(html()).toContain('aria-expanded="true"')
  })
})
