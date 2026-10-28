// Planned weeks per portfolio, as horizontal bars from one scale. The weeks are written next to each bar,
// so the numbers do not depend on color.
export default function PortfolioBars({ rows }) {
  const max = Math.max(0, ...rows.map((r) => r.weeks))
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Add a portfolio to see where the weeks go.</p>
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Planned weeks per portfolio">
      {rows.map((r) => (
        <li key={r.portfolio} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-x-3 text-sm">
          <span className="truncate" title={r.portfolio}>{r.portfolio}</span>
          <span className="flex h-3.5 overflow-hidden rounded-sm bg-muted" role="img" aria-label={`${r.weeks} planned weeks`}>
            <span className="bg-primary" style={{ width: max > 0 ? `${(r.weeks / max) * 100}%` : '0%' }} />
          </span>
          <b className="text-right text-sm tabular-nums">{r.weeks} wk</b>
        </li>
      ))}
    </ul>
  )
}
