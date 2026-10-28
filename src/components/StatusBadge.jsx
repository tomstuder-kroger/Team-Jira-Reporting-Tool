import { Badge } from '@/components/ui/badge'
import { LABEL, bucketOf } from '@/lib/report'
import { cn } from '@/lib/utils'

const TONE = {
  closed: 'bg-success/15 text-success',
  prog: 'bg-info/15 text-info',
  review: 'bg-warning/25 text-foreground',
  open: 'bg-secondary text-secondary-foreground',
  blocked: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
}

export function BucketBadge({ bucket, children, className }) {
  return (
    <Badge variant="secondary" className={cn(TONE[bucket], className)}>
      {children ?? LABEL[bucket]}
    </Badge>
  )
}

export default function StatusBadge({ item }) {
  const b = bucketOf(item)
  return (
    <span title={item.s !== LABEL[b] ? `Jira status: ${item.s}` : undefined}>
      <BucketBadge bucket={b} />
    </span>
  )
}
