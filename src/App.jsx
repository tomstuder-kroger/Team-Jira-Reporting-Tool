import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KpiStrip from '@/components/KpiStrip'
import BlockerAlert from '@/components/BlockerAlert'
import DesignerCard from '@/components/DesignerCard'
import QuietTable from '@/components/QuietTable'
import KdsNotice from '@/components/KdsNotice'
import RangeControls from '@/components/RangeControls'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import config, { usingExampleConfig } from '@/lib/config'
import { buildReport, clockLabel, pulledLabel } from '@/lib/report'
import { defaultRange, loadRange, resolveWindow, saveRange, windowLabel } from '@/lib/windows'

const SectionTitle = ({ children }) => (
  <h2 className="border-b-2 border-primary pb-2 font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground">{children}</h2>
)

function useReportData() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    try {
      const res = await fetch(`/data/report.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`report.json returned ${res.status}`)
      const data = await res.json()
      if (data?.version !== 2) throw new Error('report.json is in an older format')
      if (!data?.meta?.pulledAt || !Array.isArray(data?.tickets)) throw new Error('report.json is missing meta or tickets')
      setState({ status: 'ready', data, error: null })
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: e.message }))
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

function useJiraRefresh(reload) {
  const [state, setState] = useState({ busy: false, result: null, error: null, finishedAt: 0 })

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, result: null, error: null }))
    try {
      const res = await fetch('/api/refresh', { method: 'POST', headers: { Accept: 'application/json' } })
      let body = null
      try { body = await res.json() } catch { /* not JSON */ }
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || (res.status === 404 ? 'The refresh service is not running. Start the app with npm start.' : `Refresh failed (${res.status}).`))
      }
      await reload()
      setState({ busy: false, result: body, error: null, finishedAt: Date.now() })
    } catch (e) {
      setState((s) => ({ ...s, busy: false, result: null, error: e.message, finishedAt: Date.now() }))
    }
  }, [reload])

  return { ...state, refresh }
}

function refreshMessage(r) {
  const parts = [`Refreshed from Jira at ${clockLabel(new Date(r.pulledAt))}: ${r.tickets} tickets (${r.open} open, ${r.closed} resolved in the last ${r.historyDays} days).`]
  if (r.skipped) parts[0] = `Refreshed from Jira moments ago (${clockLabel(new Date(r.pulledAt))}), so Jira was not asked again.`
  if (r.warnings?.length) parts.push(`${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}: ${r.warnings.slice(0, 2).join(' ')}`)
  return parts.join(' ')
}

export default function App() {
  const { status, data, error, reload } = useReportData()
  const jira = useJiraRefresh(reload)
  const [range, setRange] = useState(loadRange)
  const changeRange = useCallback((next) => { setRange(next); saveRange(next) }, [])

  const win = useMemo(() => {
    if (!data) return null
    return resolveWindow(range, new Date(data.meta.pulledAt), new Date(data.meta.historyStart))
  }, [data, range])
  const report = useMemo(() => (data && win ? buildReport(data, win) : null), [data, win])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header onRefresh={jira.refresh} refreshing={jira.busy} />
      <main className="mx-auto flex max-w-[1120px] flex-col gap-5 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold">Designer activity</h1>
            <p className="text-sm text-muted-foreground">
              Jira activity across initiatives{win ? `, ${win.label.toLowerCase()}` : ''}
            </p>
          </div>
          {win && (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <RangeControls win={win} onChange={changeRange} />
              <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
                <dt className="text-muted-foreground">Range</dt><dd>{windowLabel(win)}</dd>
                <dt className="text-muted-foreground">Data pulled</dt><dd>{pulledLabel(data.meta)}</dd>
                <dt className="text-muted-foreground">Designers tracked</dt><dd>{report.rows.length}</dd>
              </dl>
            </div>
          )}
        </div>

        {usingExampleConfig && (
          <Alert className="p-3 text-sm">
            <AlertTitle>Using the example configuration</AlertTitle>
            <AlertDescription>
              Copy <code className="font-mono">config/report.config.example.json</code> to <code className="font-mono">config/report.config.json</code>, add your roster and Jira details, then restart <code className="font-mono">npm start</code>.
            </AlertDescription>
          </Alert>
        )}

        {win?.note && (
          <Alert className="p-3 text-sm"><AlertDescription>{win.note}</AlertDescription></Alert>
        )}

        {jira.error && (
          <Alert variant="destructive" className="p-3 text-sm">
            <AlertTitle>Refresh from Jira failed</AlertTitle>
            <AlertDescription>{jira.error} The saved data was not changed.</AlertDescription>
          </Alert>
        )}

        {jira.result && (
          <KdsNotice key={jira.finishedAt} className="max-w-3xl">
            {refreshMessage(jira.result)}
          </KdsNotice>
        )}

        {status === 'error' && (
          <Alert variant="destructive" className="p-3 text-sm">
            <AlertTitle>Could not load the report data</AlertTitle>
            <AlertDescription>
              {error}. Choose Refresh from Jira in the header to create <code className="font-mono">public/data/report.json</code>, or see README.md.
            </AlertDescription>
          </Alert>
        )}

        {report && (
          <>
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
        )}
      </main>
    </div>
  )
}
