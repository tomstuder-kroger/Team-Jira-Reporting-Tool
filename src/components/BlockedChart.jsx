// Bars: tickets blocked at the end of each week. Plain SVG, theme tokens, one scale for bars and labels.
const H = 180
const M = { top: 12, right: 12, bottom: 28, left: 34 }
const SLOT = 52
const BAR = 26

const niceMax = (n) => (n <= 4 ? 4 : Math.ceil(n / 2) * 2)

export default function BlockedChart({ weeks }) {
  const W = M.left + M.right + Math.max(weeks.length, 4) * SLOT
  const top = niceMax(Math.max(0, ...weeks.map((w) => w.blockedAtEnd)))
  const plotH = H - M.top - M.bottom
  const y = (v) => M.top + plotH - (v / top) * plotH
  const ticks = [0, top / 2, top]
  const summary = weeks.map((w) => `week of ${w.label}${w.partial ? ' (to date)' : ''}: ${w.blockedAtEnd} blocked at the end, ${w.newlyBlocked} newly blocked`).join('; ')

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tickets blocked at the end of each week. ${summary}`} className="h-auto w-full" style={{ minWidth: W }}>
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
                <rect x={cx - BAR / 2} y={y(w.blockedAtEnd)} width={BAR} height={Math.max(0, y(0) - y(w.blockedAtEnd))} rx="2" className="fill-destructive" />
                <text x={cx} y={y(w.blockedAtEnd) - 3} textAnchor="middle" fontSize="10" className="fill-foreground">{w.blockedAtEnd || ''}</text>
                <text x={cx} y={H - 10} textAnchor="middle" fontSize="11" className="fill-muted-foreground">{w.label}{w.partial ? '*' : ''}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-destructive" />Blocked at the end of the week</span>
        <span>* = week in progress, up to the last pull.</span>
      </div>
    </div>
  )
}
