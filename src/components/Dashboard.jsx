import { useCallback, useMemo, useState } from 'react'
import KpiStrip from '@/components/KpiStrip'
import BlockerAlert from '@/components/BlockerAlert'
import DesignerCard from '@/components/DesignerCard'
import QuietTable from '@/components/QuietTable'
import RangeControls from '@/components/RangeControls'
import DesignerToolbar from '@/components/DesignerToolbar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import config from '@/lib/config'
import { buildReport, pulledLabel } from '@/lib/report'
import { loadRange, resolveWindow, saveRange, windowLabel } from '@/lib/windows'
import { useToday } from '@/lib/today'
import { filterDesigners, loadView, saveView, sortDesigners } from '@/lib/designers'
import { cn } from '@/lib/utils'

const SectionTitle = ({ children }) => (
  <h2 className="border-b-2 border-primary pb-2 font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground">{children}</h2>
)

export default function Dashboard({ data }) {
  const [range, setRange] = useState(loadRange)
  const changeRange = useCallback((next) => { setRange(next); saveRange(next) }, [])

  const [view, setView] = useState(loadView)
  const changeView = useCallback((next) => { setView(next); saveView(next) }, [])
  const [filter, setFilter] = useState('')
  const [hidden, setHidden] = useState(() => new Set()) // names whose ticket lists are hidden; not remembered between visits
  const toggle = useCallback((name) => setHidden((h) => { const n = new Set(h); if (n.has(name)) n.delete(name); else n.add(name); return n }), [])

  const today = useToday()
  const win = useMemo(() => resolveWindow(range, new Date(data.meta.pulledAt), new Date(data.meta.historyStart), today), [data, range, today])
  const report = useMemo(() => buildReport(data, win), [data, win])
  // The filter and sort only change what is shown. The summary tiles and blockers always cover everyone.
  const active = useMemo(() => sortDesigners(filterDesigners(report.active, filter), view.sort), [report, filter, view.sort])
  const quiet = useMemo(() => sortDesigners(filterDesigners(report.quiet, filter), view.sort === 'attention' ? 'az' : view.sort), [report, filter, view.sort])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Designer activity</h1>
          <p className="text-sm text-muted-foreground">Jira activity across initiatives, {win.label.toLowerCase()}</p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <RangeControls win={win} range={range} onChange={changeRange} />
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
            <dt className="text-muted-foreground">Range</dt><dd>{windowLabel(win)}</dd>
            {win.compare?.ok && (<><dt className="text-muted-foreground">Compared with</dt><dd>{win.compare.label}</dd></>)}
            <dt className="text-muted-foreground">Data pulled</dt><dd>{pulledLabel(data.meta)}</dd>
            <dt className="text-muted-foreground">Designers tracked</dt><dd>{report.rows.length}</dd>
          </dl>
        </div>
      </div>

      {win.note && (
        <Alert className="p-3 text-sm"><AlertDescription>{win.note}</AlertDescription></Alert>
      )}

      {win.stale && (
        <Alert className="p-3 text-sm"><AlertDescription>The saved data is from {pulledLabel(data.meta)}. Calendar ranges follow today's date, but anything after that pull is missing. Choose Refresh from Jira to bring it up to date.</AlertDescription></Alert>
      )}

      <KpiStrip kpis={report.kpis} />
      <BlockerAlert blocked={report.blocked} />

      <DesignerToolbar
        view={view}
        onView={changeView}
        filter={filter}
        onFilter={setFilter}
        onExpandAll={() => setHidden(new Set())}
        onCollapseAll={() => setHidden(new Set(report.active.map((d) => d.name)))}
      />

      <SectionTitle>Active designers ({filter.trim() ? `${active.length} of ${report.active.length}` : report.active.length})</SectionTitle>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{report.active.length === 0 ? 'No designer had activity in this range.' : 'No active designer matches that name.'}</p>
      ) : (
        <section
          aria-label="Active designers"
          className={cn('gap-3.5', view.layout === 'list' ? 'flex flex-col items-stretch' : 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] items-start')}
        >
          {active.map((d) => <DesignerCard key={d.name} d={d} open={!hidden.has(d.name)} onToggle={() => toggle(d.name)} />)}
        </section>
      )}

      <SectionTitle>No activity in this range{filter.trim() ? ` (${quiet.length} of ${report.quiet.length})` : ''}</SectionTitle>
      <QuietTable quiet={quiet} filtered={Boolean(filter.trim())} />

      <footer className="pt-1 text-center text-xs text-muted-foreground">
        Source: Jira ({data.meta.source}), projects {config.projects.join(', ')}. A ticket counts for a designer as assignee or in the Pair field. A ticket counts in a range when it was created, resolved or changed status in it; comment-only edits do not count. Statuses shown are the ones at the end of the range, replayed from each ticket's status history. Tickets follow their current assignee and Pair field, so a later reassignment moves past activity to the new owner. A range never goes past the last refresh, and the saved data goes back {data.meta.historyDays} days. Calendar and fiscal ranges follow today's date; "Last 7, 14 or 30 days" count back from the last refresh. Refresh from Jira in the header pulls current data.
      </footer>
    </>
  )
}
