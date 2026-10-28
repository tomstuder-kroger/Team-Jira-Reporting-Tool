import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const TONE = { success: 'text-success', warning: 'text-warning', destructive: 'text-destructive' }

export default function KpiStrip({ kpis }) {
  return (
    <section aria-label="Summary" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
      {kpis.map((k) => (
        <Card key={k.id} className="gap-1 p-3.5">
          <b className={cn('font-heading text-3xl font-extrabold leading-none tabular-nums', TONE[k.tone])}>{k.value}</b>
          <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">{k.label}</span>
          <small className="text-xs text-muted-foreground">{k.hint}</small>
        </Card>
      ))}
    </section>
  )
}
