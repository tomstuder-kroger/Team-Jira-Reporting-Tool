import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const TONE = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive' }

// Change against the comparison range. Color only when the direction is clearly good or bad, and the sign is always written.
function Change({ k }) {
  if (k.change === undefined) return null
  const sign = k.change > 0 ? '+' : k.change < 0 ? '-' : ''
  const better = k.good && k.change !== 0 && (k.change > 0) === (k.good === 'up')
  const worse = k.good && k.change !== 0 && !better
  return (
    <small className={cn('text-xs tabular-nums', better ? 'text-success' : worse ? 'text-destructive' : 'text-muted-foreground')}>
      {k.change === 0 ? 'no change' : `${sign}${Math.abs(k.change)}`} vs {k.prev} compared
    </small>
  )
}

export default function KpiStrip({ kpis }) {
  return (
    <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
      {kpis.map((k) => (
        <Card key={k.id} className="gap-1 p-3.5">
          <b className={cn('font-heading text-3xl font-extrabold leading-none tabular-nums', TONE[k.tone])}>{k.value}</b>
          <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">{k.label}</span>
          <small className="text-xs text-muted-foreground">{k.hint}</small>
          <Change k={k} />
        </Card>
      ))}
    </section>
  )
}
