import { useCallback, useMemo, useState } from 'react'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import WeeklyChart from '@/components/WeeklyChart'
import WeeklyTable from '@/components/WeeklyTable'
import StatusDonut from '@/components/StatusDonut'
import ClosedByDesigner from '@/components/ClosedByDesigner'
import VelocityTiles from '@/components/VelocityTiles'
import BlockedChart from '@/components/BlockedChart'
import BlockedTiles from '@/components/BlockedTiles'
import { pulledLabel } from '@/lib/report'
import { blockedOverTime } from '@/lib/blocked'
import { buildWeeks, closedByDesigner, loadSpan, openByStatus, saveSpan, velocity } from '@/lib/weeks'
import { cn } from '@/lib/utils'

const FIELD =
  'h-8 rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

const SpanLabel = { 4: 'Last 4 weeks', 8: 'Last 8 weeks', 12: 'Last 12 weeks', all: 'All saved weeks' }

export default function ReportsPage({ data }) {
  const [span, setSpan] = useState(loadSpan)
  const change = useCallback((v) => { setSpan(v); saveSpan(v) }, [])

  const res = useMemo(() => buildWeeks(data, span), [data, span])
  const vel = useMemo(() => velocity(res), [res])
  const blk = useMemo(() => blockedOverTime(res), [res])
  const open = useMemo(() => openByStatus(data), [data])
  const byDesigner = useMemo(() => closedByDesigner(res), [res])
  const complete = res.weeks.filter((w) => !w.partial).length

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Tickets opened and closed by week, {complete} complete {complete === 1 ? 'week' : 'weeks'} shown
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="span-select">Weeks shown</Label>
            <select id="span-select" className={cn(FIELD, 'min-w-44')} value={span} onChange={(e) => change(e.target.value)}>
              {Object.entries(SpanLabel).map(([id, label]) => (
                <option key={id} value={id}>{label}{id === 'all' ? ` (${res.available})` : ''}</option>
              ))}
            </select>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
            <dt className="text-muted-foreground">Data pulled</dt><dd>{pulledLabel(data.meta)}</dd>
          </dl>
        </div>
      </div>

      <VelocityTiles v={vel} />
      <BlockedTiles b={blk} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] items-start gap-3.5">
        <Card>
          <CardHeader>
            <CardTitle>Opened and closed by week</CardTitle>
            <CardDescription>by created and resolved date</CardDescription>
          </CardHeader>
          <WeeklyChart weeks={res.weeks} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Week by week</CardTitle>
            <CardDescription>net = opened minus closed</CardDescription>
          </CardHeader>
          <WeeklyTable weeks={blk.weeks} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Blocked over time</CardTitle>
            <CardDescription>from each ticket's status history</CardDescription>
          </CardHeader>
          <BlockedChart weeks={blk.weeks} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open work by status</CardTitle>
            <CardDescription>as of the last pull, ignores the weeks shown</CardDescription>
          </CardHeader>
          <StatusDonut slices={open.slices} total={open.total} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Closed by designer</CardTitle>
            <CardDescription>{SpanLabel[span].toLowerCase()}, to the last pull</CardDescription>
          </CardHeader>
          <ClosedByDesigner data={byDesigner} />
        </Card>
      </div>

      <footer className="pt-1 text-center text-xs text-muted-foreground">
        Opened counts tickets by created date and closed by resolved date, for tickets assigned to or paired with a tracked designer. A ticket opened and closed in the same week counts in both. A ticket that was reopened uses its latest resolved date. Weeks run Sunday to Saturday, and the week in progress ends at the last pull, so it is left out of averages. Velocity counts tickets, not story points. Blocked comes from each ticket's status history: a block runs from the change into a Blocked status to the change out of it, or to the resolved time, or to the last pull if it is still blocked. A ticket whose first recorded change leaves Blocked counts as blocked since it was created. Tickets follow their current assignee, so a reassigned ticket's past blocks count for its current owner.
      </footer>
    </>
  )
}
