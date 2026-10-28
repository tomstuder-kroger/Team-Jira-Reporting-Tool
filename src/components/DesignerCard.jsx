import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import StatusBadge, { BucketBadge } from '@/components/StatusBadge'
import { LABEL, bucketOf, byRank, issueUrl, shortName } from '@/lib/report'

function TicketRows({ items, showAssignee }) {
  return (
    <div className="flex flex-col">
      {[...items].sort(byRank).map((item) => (
        <div key={item.k} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 border-t py-1.5 first:border-t-0 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
          <a className="font-mono text-xs text-primary underline-offset-2 hover:underline dark:text-[oklch(0.75_0.12_261.6)]" href={issueUrl(item.k)} target="_blank" rel="noreferrer">{item.k}</a>
          <div className="order-last col-span-2 text-sm [overflow-wrap:anywhere] sm:order-none sm:col-span-1">
            {item.t}
            {showAssignee && item.a && <span className="block text-xs text-muted-foreground">Assignee: {item.a}</span>}
          </div>
          <StatusBadge item={item} />
        </div>
      ))}
    </div>
  )
}

function Disclosure({ label, items, showAssignee }) {
  return (
    <details className="group border-t pt-2">
      <summary className="cursor-pointer rounded-sm text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</summary>
      <div className="mt-1"><TicketRows items={items} showAssignee={showAssignee} /></div>
    </details>
  )
}

const Group = ({ children }) => (
  <div className="-mb-1 mt-0.5 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">{children}</div>
)

export default function DesignerCard({ d }) {
  const first = shortName(d.name).split(' ')[0]
  const counts = ['closed', 'prog', 'review', 'blocked']
    .map((b) => [b, d.week.filter((i) => bucketOf(i) === b).length])
    .filter(([, n]) => n > 0)

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{shortName(d.name)}</CardTitle>
          <CardDescription>
            {d.own.length} assigned, {d.pair.length} paired this week{d.own.length === 0 ? ' (paired only)' : ''}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-1">
          {counts.map(([b, n]) => <BucketBadge key={b} bucket={b}>{n} {LABEL[b]}</BucketBadge>)}
        </div>
      </CardHeader>

      {d.own.length > 0 && (<><Group>Assigned to {first}</Group><TicketRows items={d.own} /></>)}

      {d.pair.length > 5 ? (
        <Disclosure label={`Paired this week (${d.pair.length})`} items={d.pair} showAssignee />
      ) : d.pair.length > 0 ? (
        <><Group>Paired this week</Group><TicketRows items={d.pair} showAssignee /></>
      ) : null}

      {d.idle.length > 0 && <Disclosure label={`Open, no update this week (${d.idle.length})`} items={d.idle} showAssignee />}

      <p className="rounded-md bg-primary/10 px-2.5 py-2 text-sm text-foreground">{d.note}</p>
    </Card>
  )
}
