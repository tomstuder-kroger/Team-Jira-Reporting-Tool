import { useCallback, useMemo, useState } from 'react'
import KpiStrip from '@/components/KpiStrip'
import BlockerAlert from '@/components/BlockerAlert'
import DesignerCard from '@/components/DesignerCard'
import QuietTable from '@/components/QuietTable'
import RangeControls from '@/components/RangeControls'
import { Alert, AlertDescription } from '@/components/ui/alert'
import config from '@/lib/config'
import { buildReport, pulledLabel } from '@/lib/report'
import { loadRange, resolveWindow, saveRange, windowLabel } from '@/lib/windows'

const SectionTitle = ({ children }) => (
  <h2 className="border-b-2 border-primary pb-2 font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground">{children}</h2>
)

export default function Dashboard({ data }) {
  const [range, setRange] = useState(loadRange)
  const changeRange = useCallback((next) => { setRange(next); saveRange(next) }, [])

  const win = useMemo(() => resolveWindow(range, new Date(data.meta.pulledAt), new Date(data.meta.historyStart)), [data, range])
  const report = useMemo(() => buildReport(data, win), [data, win])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-heading text-2xl font-extrabold">Designer activity</h1>
          <p className="text-sm text-muted-foreground">Jira activity across initiatives, {win.label.toLowerCase()}</p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <RangeControls win={win} onChange={changeRange} />
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
            <dt className="text-muted-foreground">Range</dt><dd>{windowLabel(win)}</dd>
            <dt className="text-muted-foreground">Data pulled</dt><dd>{pulledLabel(data.meta)}</dd>
            <dt className="text-muted-foreground">Designers tracked</dt><dd>{report.rows.length}</dd>
          </dl>
        </div>
      </div>

      {win.note && (
        <Alert className="p-3 text-sm"><AlertDescription>{win.note}</AlertDescription></Alert>
      )}

      <KpiStrip kpis={report.kpis} />
      <BlockerAlert blocked={report.blocked} />

      <SectionTitle>Active designers ({report.active.length})</SectionTitle>
      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] items-start gap-3.5">
        {report.active.map((d) => <DesignerCard key={d.name} d={d} />)}
      </section>

      <SectionTitle>No activity in this range</SectionTitle>
      <QuietTable quiet={report.quiet} />

      <footer className="pt-1 text-center text-xs text-muted-foreground">
        Source: Jira ({data.meta.source}), projects {config.projects.join(', ')}. A ticket counts for a designer as assignee or in the Pair field. Closed tickets count when resolved in the range, open tickets when updated in it, and "updated" includes any edit. Ranges end at the last pull, and the saved data goes back {data.meta.historyDays} days. Refresh from Jira in the header pulls current data.
      </footer>
    </>
  )
}
