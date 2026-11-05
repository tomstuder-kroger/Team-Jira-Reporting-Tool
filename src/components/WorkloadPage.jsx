import { useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import KpiStrip from '@/components/KpiStrip'
import config from '@/lib/config'
import { shortName, pulledLabel } from '@/lib/report'
import { useToday } from '@/lib/today'
import { buildWorkload } from '@/lib/workload'
import { loadWorkWindow, resolveWorkWindow, saveWorkWindow, workWindowGroups } from '@/lib/workWindow'
import { cn } from '@/lib/utils'

const FIELD =
  'h-8 rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

const TONE = { under: undefined, healthy: 'success', near: 'warning', full: 'destructive' }
const TEXT = { under: 'text-muted-foreground', healthy: 'text-success', near: 'text-orange-600 dark:text-orange-400', full: 'text-destructive' }
const dateText = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const days = (n) => `${Math.round(n * 10) / 10}d`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function Member({ row, scale }) {
  const { state } = row
  const label =
    state === 'nocap' ? 'No capacity set' : state === 'noopen' ? 'No open work' : state === 'nosized' ? 'No sized work' : `${row.pctRounded}%`
  const flags = [
    row.late > 0 && `${row.late} late`,
    row.unsized > 0 && `${row.unsized} unsized`,
  ].filter(Boolean)
  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-1 border-t py-3 first:border-t-0 sm:grid-cols-[11rem_1fr_15rem]">
      <div>
        <div className="text-sm font-semibold">{shortName(row.name)}</div>
        <div className="text-xs text-muted-foreground">{Math.round(row.weeklyDays * 10) / 10}d/week</div>
      </div>
      <div
        className="relative h-3 rounded-full bg-muted"
        role="img"
        aria-label={`${shortName(row.name)}: ${days(row.progDays)} in progress, ${days(row.queuedDays)} queued, ${days(row.capacity)} capacity in the window`}
      >
        <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full" style={{ width: `${(row.assigned / scale) * 100}%` }}>
          <div className="h-full bg-info" style={{ width: `${row.assigned ? (row.progDays / row.assigned) * 100 : 0}%` }} />
          <div className="h-full bg-warning" style={{ width: `${row.assigned ? (row.queuedDays / row.assigned) * 100 : 0}%` }} />
        </div>
        {row.capacity > 0 && <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${(row.capacity / scale) * 100}%` }} />}
      </div>
      <div className="text-xs tabular-nums">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className={cn('text-sm', state === 'ok' ? TEXT[row.band] : 'text-muted-foreground')}>{label}</b>
          {state === 'ok' && (
            <>
              <span className="text-muted-foreground">{days(row.assigned)} · {Math.round(row.weeksOfWork * 10) / 10} wks</span>
              {row.clears && <span className="text-muted-foreground">clears {dateText(row.clears)}</span>}
            </>
          )}
        </div>
        {flags.length > 0 && <div className="text-destructive">{flags.join(' · ')}</div>}
      </div>
    </li>
  )
}

export default function WorkloadPage({ data, cfg = config }) {
  const today = useToday()
  const [choice, setChoice] = useState(() => loadWorkWindow(new Date()))
  const win = useMemo(() => resolveWorkWindow(choice, today), [choice, today])
  const groups = useMemo(() => workWindowGroups(today), [today])
  const result = useMemo(
    () => (data && win.ok ? buildWorkload({ data, cfg, win, today }) : null),
    [data, cfg, win, today],
  )

  const pick = (id) => {
    const next = { id }
    setChoice(next)
    saveWorkWindow(next)
  }

  const heading = (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="font-heading text-2xl font-extrabold">Workload</h1>
        <p className="text-sm text-muted-foreground">
          {result?.status === 'ready'
            ? `Open, assigned work sized by T-shirt (${Object.entries(result.wl.sizeDays).map(([k, v]) => `${k} ${v}d`).join(' · ')}). Default ${Math.round(result.wl.daysPerWeek * result.wl.focus * 10) / 10} days a week per person. Time off is not included.`
            : 'Open, assigned work sized by T-shirt, compared with the days each person has.'}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="window-select">Capacity window</Label>
        <div className="flex items-center gap-2">
          <select id="window-select" className={cn(FIELD, 'min-w-40')} value={choice.id} onChange={(e) => pick(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.disabled && p.id !== choice.id} title={p.reason}>
                    {p.label}{p.assumed ? ' (assumed dates)' : ''}{p.disabled ? ' (none left)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {win.ok && <span className="text-xs tabular-nums text-muted-foreground">{dateText(win.start)} to {dateText(win.end)} · {plural(win.workDays, 'work day')}</span>}
        </div>
      </div>
    </div>
  )

  if (!data) return <>{heading}<p className="text-sm text-muted-foreground">Loading…</p></>

  if (result?.status === 'not-configured') {
    return (
      <>
        {heading}
        <Alert className="p-3 text-sm">
          <AlertTitle>Workload is not set up</AlertTitle>
          <AlertDescription>
            {result.absent
              ? 'Add a "workload" block to config/report.config.json with the Jira field IDs for the T-shirt size and for rank (see config/report.config.example.json), then restart npm start and refresh from Jira.'
              : `${result.reason} Fix it in config/report.config.json, then restart npm start.`}
          </AlertDescription>
        </Alert>
      </>
    )
  }

  if (result?.status === 'needs-refresh') {
    return (
      <>
        {heading}
        <Alert className="p-3 text-sm">
          <AlertTitle>Refresh from Jira to load sizes and ranks</AlertTitle>
          <AlertDescription>The saved data was pulled before sizes, due dates and rank were included. Choose Refresh from Jira in the header; the other pages keep working in the meantime.</AlertDescription>
        </Alert>
      </>
    )
  }

  if (!win.ok || !result) return <>{heading}<Alert className="p-3 text-sm"><AlertDescription>{win.reason}</AlertDescription></Alert></>

  const { rows, team, leftOut } = result
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.capacity * 1.25, r.assigned)))
  const kpis = [
    {
      id: 'assigned',
      value: team.capacity > 0 && team.assigned > 0 ? `${team.pctRounded}%` : team.countable === 0 ? '0%' : '–',
      label: 'Assigned work',
      hint: `${days(team.assigned)} of ${days(team.capacity)} capacity · ${days(team.progDays)} in progress, ${days(team.queuedDays)} queued`,
      tone: TONE[team.band],
    },
    {
      id: 'capacity',
      value: days(team.capacity),
      label: `Capacity · ${win.label}`,
      hint: team.capacity > team.assigned ? `${days(team.free)} (${team.freePct}%) free` : 'fully booked',
    },
    {
      id: 'over',
      value: `${team.overCount} of ${team.peopleWithCapacity}`,
      label: 'Over capacity',
      hint: `people with more work than fits by ${dateText(win.end)}`,
      tone: team.overCount > 0 ? 'destructive' : undefined,
    },
    {
      id: 'unsized',
      value: team.unsized,
      label: 'Unsized tickets',
      hint: `${team.sized} of ${team.countable} sized · not counted in load`,
      tone: team.unsized > 0 ? 'destructive' : undefined,
    },
  ]

  return (
    <>
      {heading}

      {team.mostlyUnsized && (
        <Alert className="p-3 text-sm">
          <AlertTitle>Most open work has no T-shirt size</AlertTitle>
          <AlertDescription>
            Only {team.sized} of {team.countable} open tickets have a size, so the loads below are understated. Unsized tickets add 0 days; they do not mean free time.
          </AlertDescription>
        </Alert>
      )}

      <KpiStrip kpis={kpis} />

      <Card className="gap-0 p-0">
        <CardHeader className="gap-1 px-4 pt-4 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Team members</CardTitle>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-info" />In progress</span>
              <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-warning" />Queued</span>
              <span className="inline-flex items-center gap-1"><i className="h-3 w-0.5 bg-foreground" />Capacity in window</span>
            </div>
          </div>
          <CardDescription>
            Colors: grey up to 50%, green to 85%, orange to 95%, red above.
          </CardDescription>
        </CardHeader>
        <ul className="px-4 pb-2">
          {rows.map((r) => <Member key={r.name} row={r} scale={scale} />)}
        </ul>
      </Card>

      <footer className="pt-1 text-center text-xs text-muted-foreground">
        {plural(team.countable, 'open ticket')} counted, assigned to someone on the roster; Epics are left out and a paired designer does not carry the load.
        {leftOut > 0 && ` ${plural(leftOut, 'open ticket')} name a roster member in Pair but have no roster assignee and are not counted.`}
        {' '}In-progress work counts at full size. Time off and holidays are not subtracted. Data as of {pulledLabel(data.meta)}.
      </footer>
    </>
  )
}
