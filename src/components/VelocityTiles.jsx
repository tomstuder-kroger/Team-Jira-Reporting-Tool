import KpiStrip from '@/components/KpiStrip'

const num = (n, digits = 1) => (n === null ? 'n/a' : Number.isInteger(n) ? String(n) : n.toFixed(digits))

// Velocity from ticket counts only. Story points are not used, because the team does not apply them consistently.
export default function VelocityTiles({ v }) {
  const kpis = [
    { id: 'avg', value: num(v.average), label: 'Closed per week', hint: v.averageWeeks ? `average of the last ${v.averageWeeks} complete ${v.averageWeeks === 1 ? 'week' : 'weeks'}` : 'no complete week yet', tone: 'success' },
    { id: 'best', value: num(v.best), label: 'Best week', hint: 'most tickets closed in a complete week' },
    { id: 'low', value: num(v.low), label: 'Lowest week', hint: 'fewest tickets closed in a complete week' },
    { id: 'median', value: v.medianDays === null ? 'n/a' : `${num(v.medianDays)} d`, label: 'Median time to close', hint: `created to resolved, ${v.closedCount} ticket${v.closedCount === 1 ? '' : 's'}` },
  ]
  return <KpiStrip kpis={kpis} />
}
