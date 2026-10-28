// Grouped bars, opened (blue) beside closed (green), one pair per week. Plain SVG, one scale for
// bars, gridlines and labels. Colors are theme tokens, so it follows light and dark mode.

const H = 220
const M = { top: 12, right: 12, bottom: 28, left: 34 }
const SLOT = 52 // width of one week
const BAR = 18

const niceMax = (n) => {
  if (n <= 5) return 5
  const step = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / step) * step
}

export default function WeeklyChart({ weeks }) {
  const W = M.left + M.right + Math.max(weeks.length, 4) * SLOT
  const top = niceMax(Math.max(0, ...weeks.flatMap((w) => [w.opened, w.closed])))
  const plotH = H - M.top - M.bottom
  const y = (v) => M.top + plotH - (v / top) * plotH
  const ticks = [0, top / 2, top].map((v) => Math.round(v * 10) / 10)

  const summary = weeks.map((w) => `week of ${w.label}${w.partial ? ' (to date)' : ''}: ${w.opened} opened, ${w.closed} closed`).join('; ')

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tickets opened and closed per week. ${summary}`} className="h-auto w-full" style={{ minWidth: W }}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" />
              <text x={M.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground" fontSize="11">{v}</text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = M.left + i * SLOT + SLOT / 2
            return (
              <g key={w.label} opacity={w.partial ? 0.65 : 1}>
                <rect x={cx - BAR - 1} y={y(w.opened)} width={BAR} height={Math.max(0, y(0) - y(w.opened))} rx="2" className="fill-primary" />
                <rect x={cx + 1} y={y(w.closed)} width={BAR} height={Math.max(0, y(0) - y(w.closed))} rx="2" className="fill-success" />
                <text x={cx - BAR / 2 - 1} y={y(w.opened) - 3} textAnchor="middle" fontSize="10" className="fill-foreground">{w.opened || ''}</text>
                <text x={cx + BAR / 2 + 1} y={y(w.closed) - 3} textAnchor="middle" fontSize="10" className="fill-foreground">{w.closed || ''}</text>
                <text x={cx} y={H - 10} textAnchor="middle" fontSize="11" className="fill-muted-foreground">{w.label}{w.partial ? '*' : ''}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-primary" />Opened</span>
        <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-success" />Closed</span>
        <span>Weeks start Sunday. * = week in progress, up to the last pull.</span>
      </div>
    </div>
  )
}
