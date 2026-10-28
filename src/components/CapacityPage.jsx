import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { BucketBadge } from '@/components/StatusBadge'
import KpiStrip from '@/components/KpiStrip'
import KdsNotice from '@/components/KdsNotice'
import LabelList from '@/components/LabelList'
import PortfolioBars from '@/components/PortfolioBars'
import config from '@/lib/config'
import { STATUS_LABEL, addLabel, capacityRows, emptyCapacity, removeLabel, renameLabel, setPercent, setTeamMember, setTimeOff, summarize } from '@/lib/capacity'
import { sortDesigners } from '@/lib/designers'
import { currentQuarterKey, fiscalQuarters, parseQuarterKey, quarterInfo } from '@/lib/fiscal'
import { fetchCapacity, saveCapacity } from '@/lib/capacityApi'
import { shortName } from '@/lib/report'
import { useToday } from '@/lib/today'
import { cn } from '@/lib/utils'

const FIELD =
  'h-8 rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

// How each status looks, reusing the badge colors used elsewhere: red over, green fully, blue under, grey not planned.
const BADGE = { over: 'blocked', fully: 'closed', under: 'prog', none: 'open' }
const dateText = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const weeksText = (n) => `${n} ${n === 1 ? 'week' : 'weeks'}`

export default function CapacityPage() {
  const today = useToday()
  const quarters = useMemo(() => fiscalQuarters(), [])
  const [key, setKey] = useState(() => currentQuarterKey(new Date()) ?? quarters[0].key)
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(0)

  useEffect(() => {
    let live = true
    fetchCapacity()
      .then((r) => { if (live) { setSaved(r.capacity); setDraft(r.capacity) } })
      .catch((e) => { if (live) setLoadError(e.message) })
    return () => { live = false }
  }, [])

  const dirty = useMemo(() => saved && draft && JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft])
  const info = parseQuarterKey(key) && quarterInfo(parseQuarterKey(key).year, parseQuarterKey(key).quarter)
  const names = useMemo(() => config.roster.map((r) => r.jiraName), [])
  const cap = draft ?? emptyCapacity()

  const rows = useMemo(() => sortDesigners(capacityRows(names, cap, key), 'az'), [names, cap, key])
  const sum = useMemo(() => summarize(rows, cap.portfolios, cap.teams), [rows, cap.portfolios, cap.teams])

  const edit = (fn) => { setDraft((d) => fn(d)); setSaveError(null) }
  const discard = () => { setDraft(saved); setSaveError(null) }
  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const r = await saveCapacity(draft)
      setSaved(r.capacity)
      setDraft(r.capacity)
      setNotice((n) => n + 1)
    } catch (e) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const kpis = [
    { id: 'util', value: `${sum.utilization}%`, label: 'Team utilization', hint: 'planned weeks of available weeks', tone: sum.utilization > 100 ? 'destructive' : undefined },
    { id: 'avail', value: sum.available, label: 'Available weeks', hint: `${weeksText(info?.weeks ?? 0)} each, less time off` },
    { id: 'planned', value: sum.planned, label: 'Planned weeks', hint: `${sum.unallocatedWeeks} not yet planned` },
    { id: 'over', value: sum.over, label: 'Over 100%', hint: 'people planned above their time', tone: sum.over > 0 ? 'destructive' : undefined },
    { id: 'none', value: sum.unplanned, label: 'Not planned', hint: `of ${sum.people} people` },
  ]

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Capacity</h1>
          <p className="text-sm text-muted-foreground">
            Planned share of each person's time by portfolio, for a fiscal quarter. Weeks, not story points.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quarter-select">Fiscal quarter</Label>
            <select id="quarter-select" className={cn(FIELD, 'min-w-48')} value={key} onChange={(e) => setKey(e.target.value)}>
              {quarters.map((q) => (
                <option key={q.key} value={q.key}>Q{q.quarter} FY{q.year}{q.key === currentQuarterKey(today) ? ' (now)' : ''}{q.assumed ? ' (assumed dates)' : ''}</option>
              ))}
            </select>
          </div>
          {info && (
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
              <dt className="text-muted-foreground">Dates</dt><dd>{dateText(info.start)} to {dateText(info.end)}, {info.end.getFullYear()}</dd>
              <dt className="text-muted-foreground">Length</dt><dd>{weeksText(info.weeks)}</dd>
            </dl>
          )}
        </div>
      </div>

      {info?.assumed && (
        <Alert className="p-3 text-sm">
          <AlertTitle>FY{info.year} dates are assumed</AlertTitle>
          <AlertDescription>The quarter lengths for this year follow the FY2026 pattern (16, 12, 12 and 12 weeks) but have not been checked against Kroger's printed calendar. The capacity planning app lists FY2027 as 13 weeks each. Available weeks depend on this, so confirm before relying on it.</AlertDescription>
        </Alert>
      )}

      {(loadError || saveError) && (
        <Alert variant="destructive" className="p-3 text-sm">
          <AlertTitle>{loadError ? 'Could not load the capacity plan' : 'The plan was not saved'}</AlertTitle>
          <AlertDescription>{loadError || saveError}</AlertDescription>
        </Alert>
      )}

      {notice > 0 && <KdsNotice key={notice} className="max-w-3xl">Capacity plan saved. The previous version is kept in config/capacity.backup.json.</KdsNotice>}

      {draft && (
        <>
          <KpiStrip kpis={kpis} />

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-3.5">
            <Card>
              <CardHeader>
                <CardTitle>Planned weeks by portfolio</CardTitle>
                <CardDescription>available weeks x each person's %</CardDescription>
              </CardHeader>
              <PortfolioBars rows={sum.perPortfolio} />
              {sum.perTeam.length > 0 && (
                <ul className="flex flex-col gap-1 border-t pt-2 text-sm" aria-label="Utilization by team">
                  {sum.perTeam.some(() => true) && <li className="text-xs text-muted-foreground">Someone on two teams is counted in full under each, so these rows do not add up to the team total.</li>}
                  {sum.perTeam.map((g) => (
                    <li key={g.team || 'none'} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">{g.team || 'No team'} <span className="text-xs text-muted-foreground">({g.people})</span></span>
                      <span className="tabular-nums"><b>{g.utilization}%</b> <span className="text-xs text-muted-foreground">{g.planned} of {g.available} wk</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Portfolios and teams</CardTitle>
                <CardDescription>you define these</CardDescription>
              </CardHeader>
              <LabelList title="Portfolios" noun="portfolio" items={cap.portfolios}
                onAdd={(n) => edit((d) => addLabel(d, 'portfolios', n))}
                onRename={(a, b) => edit((d) => renameLabel(d, 'portfolios', a, b))}
                onRemove={(n) => edit((d) => removeLabel(d, 'portfolios', n))} />
              <LabelList title="Teams" noun="team" items={cap.teams}
                onAdd={(n) => edit((d) => addLabel(d, 'teams', n))}
                onRename={(a, b) => edit((d) => renameLabel(d, 'teams', a, b))}
                onRemove={(n) => edit((d) => removeLabel(d, 'teams', n))} />
              <p className="text-xs text-muted-foreground">Removing a portfolio deletes its percentages in every quarter. Removing a team takes it off everyone who was on it.</p>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="border-b-2 border-primary pb-2 font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground">Allocation by person ({names.length})</h2>
            <div className="flex flex-wrap items-center gap-2">
              {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
              <Button size="lg" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save plan'}</Button>
              <Button size="lg" variant="outline" onClick={discard} disabled={!dirty || saving}>Discard changes</Button>
            </div>
          </div>

          {cap.portfolios.length === 0 && <p className="text-sm text-muted-foreground">Add a portfolio above, then enter each person's percentages here.</p>}

          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[640px] border-collapse text-sm tabular-nums">
              <caption className="sr-only">Planned time off and percentage by portfolio for each person in {key}</caption>
              <thead>
                <tr className="bg-muted text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5 font-medium">Designer</th>
                  <th scope="col" className="px-3 py-2.5 font-medium" title="A person can be on more than one team">Teams</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium" title="Weeks off this quarter">Time off (wk)</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium" title="Weeks in the quarter minus time off">Available (wk)</th>
                  {cap.portfolios.map((p) => <th key={p} scope="col" className="px-3 py-2.5 text-right font-medium">{p} %</th>)}
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-t align-middle">
                    <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-semibold" title={r.name}>{shortName(r.name)}</th>
                    <td className="px-3 py-2">
                      <details className="relative">
                        <summary className={cn(FIELD, 'flex w-44 cursor-pointer items-center truncate')} aria-label={`Teams for ${shortName(r.name)}`}>
                          <span className="truncate">{r.teams.length ? r.teams.join(', ') : 'No team'}</span>
                        </summary>
                        <div className="absolute z-10 mt-1 flex w-52 flex-col gap-1.5 rounded-md border bg-card p-2 shadow-md">
                          {cap.teams.length === 0 && <span className="text-xs text-muted-foreground">Add a team first.</span>}
                          {cap.teams.map((t) => (
                            <label key={t} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={r.teams.includes(t)} onChange={(e) => edit((d) => setTeamMember(d, r.name, t, e.target.checked))} />
                              <span className="truncate">{t}</span>
                            </label>
                          ))}
                        </div>
                      </details>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input aria-label={`Time off in weeks for ${shortName(r.name)}`} type="number" inputMode="decimal" min={0} max={20} step={0.5} className={cn(FIELD, 'w-20 text-right')}
                        value={r.timeOff || ''} placeholder="0" onChange={(e) => edit((d) => setTimeOff(d, r.name, key, Number(e.target.value) || 0))} />
                    </td>
                    <td className="px-3 py-2 text-right">{r.available}</td>
                    {cap.portfolios.map((p) => (
                      <td key={p} className="px-3 py-2 text-right">
                        <input aria-label={`${p} percent for ${shortName(r.name)}`} type="number" inputMode="numeric" min={0} max={100} step={1} className={cn(FIELD, 'w-20 text-right')}
                          value={r.alloc[p] ?? ''} placeholder="0" onChange={(e) => edit((d) => setPercent(d, r.name, key, p, e.target.value))} />
                      </td>
                    ))}
                    <td className={cn('px-3 py-2 text-right font-semibold', r.status === 'over' && 'text-destructive')}>{r.total}%</td>
                    <td className="px-3 py-2">
                      <BucketBadge bucket={BADGE[r.status]}>
                        {r.status === 'over' ? `Over by ${r.over}%` : r.status === 'none' ? STATUS_LABEL.none : `${STATUS_LABEL[r.status]}, ${r.unallocated}% free`}
                      </BucketBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!draft && !loadError && <p className="text-sm text-muted-foreground">Loading…</p>}

      <footer className="pt-1 text-center text-xs text-muted-foreground">
        Capacity follows the capacity planning app: available weeks are the weeks in the fiscal quarter minus time off, and planned weeks are available weeks times the percentage. Under is below 90%, fully allocated is 90 to 100%, over is above 100%. A total above 100% saves but is flagged. This page does not read Jira and does not use story points. The plan is saved in <code className="font-mono">config/capacity.json</code> on this computer (git-ignored), with the previous version kept as <code className="font-mono">capacity.backup.json</code>.
      </footer>
    </>
  )
}
