import { LABEL } from '@/lib/report'

// Same colors as the status badges, so a status looks the same everywhere. Counts sit in the legend
// as well as the ring, so color is never the only carrier.
const STROKE = { blocked: 'stroke-destructive', review: 'stroke-warning', prog: 'stroke-info', open: 'stroke-muted-foreground' }
const DOT = { blocked: 'bg-destructive', review: 'bg-warning', prog: 'bg-info', open: 'bg-muted-foreground' }

const R = 15.9155 // circumference 100, so a dash length is the percentage
const STROKE_W = 5
// The ring's outer edge is R + STROKE_W / 2 from the center (about 18.4), so the drawing area must be
// wider than 2 x that, or the ring is clipped. 40 leaves a small margin on every side.
const SIZE = 40

export default function StatusDonut({ slices, total }) {
  let offset = 25 // start at 12 o'clock
  const summary = slices.map((s) => `${s.count} ${LABEL[s.bucket]}`).join(', ')

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Open tickets by status. ${total} open: ${summary}`} className="size-40 shrink-0">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" className="stroke-muted" strokeWidth={STROKE_W} />
        {total > 0 && slices.filter((s) => s.count > 0).map((s) => {
          const pct = (s.count / total) * 100
          const el = (
            <circle
              key={s.bucket}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              strokeWidth={STROKE_W}
              className={STROKE[s.bucket]}
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
            />
          )
          offset -= pct
          return el
        })}
        <text x={SIZE / 2} y={SIZE / 2 - 0.5} textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="800" className="fill-foreground">{total}</text>
        <text x={SIZE / 2} y={SIZE / 2 + 5.5} textAnchor="middle" fontSize="2.9" className="fill-muted-foreground">open</text>
      </svg>
      <ul className="flex min-w-40 flex-1 flex-col gap-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.bucket} className="flex items-center gap-2">
            <i className={`inline-block size-2.5 rounded-sm ${DOT[s.bucket]}`} />
            <span className="flex-1">{LABEL[s.bucket]}</span>
            <b className="tabular-nums">{s.count}</b>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{total ? `${Math.round((s.count / total) * 100)}%` : '0%'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
