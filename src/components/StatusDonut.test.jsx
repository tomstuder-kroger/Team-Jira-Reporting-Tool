import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import StatusDonut from './StatusDonut.jsx'

// Synthetic counts. Renders to HTML in node and checks the geometry, since a clipped ring is
// something the numbers tests cannot see.
const slices = [
  { bucket: 'blocked', count: 2 },
  { bucket: 'review', count: 12 },
  { bucket: 'prog', count: 30 },
  { bucket: 'open', count: 100 },
]
const html = renderToStaticMarkup(<StatusDonut slices={slices} total={144} />)
const num = (re) => Number(re.exec(html)[1])

describe('StatusDonut', () => {
  it('fits the whole ring inside its drawing area, with a margin on every side', () => {
    const [, , w, h] = /viewBox="([^"]+)"/.exec(html)[1].split(' ').map(Number)
    const cx = num(/<circle cx="([\d.]+)"/)
    const r = num(/ r="([\d.]+)"/)
    const stroke = num(/stroke-width="([\d.]+)"/)
    const outer = r + stroke / 2
    expect(w).toBe(h)
    expect(cx).toBe(w / 2)
    expect(cx - outer).toBeGreaterThanOrEqual(1) // at least one unit clear of every edge
    expect(cx + outer).toBeLessThanOrEqual(w - 1)
  })

  it('draws one arc per status that has tickets, and shows the total and each count', () => {
    expect((html.match(/stroke-dasharray/g) || []).length).toBe(4)
    expect(html).toContain('>144<')
    for (const label of ['Blocked', 'PM Review', 'In Progress', 'Open']) expect(html).toContain(label)
  })

  it('draws the empty ring without arcs or NaN when nothing is open', () => {
    const empty = renderToStaticMarkup(<StatusDonut slices={slices.map((s) => ({ ...s, count: 0 }))} total={0} />)
    expect(empty).not.toContain('NaN')
    expect(empty).not.toContain('stroke-dasharray')
    expect(empty).toContain('>0<')
  })
})
