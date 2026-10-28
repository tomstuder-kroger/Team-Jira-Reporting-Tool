import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/Header'
import Dashboard from '@/components/Dashboard'
import ReportsPage from '@/components/ReportsPage'
import RosterPage from '@/components/RosterPage'
import CapacityPage from '@/components/CapacityPage'
import KdsNotice from '@/components/KdsNotice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { usingExampleConfig } from '@/lib/config'
import { clockLabel } from '@/lib/report'
import { useRoute } from '@/lib/route'

function useReportData() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: null }))
    try {
      const res = await fetch(`/data/report.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`report.json returned ${res.status}`)
      const data = await res.json()
      if (data?.version !== 3) throw new Error('report.json is in an older format')
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
  const route = useRoute()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header route={route} onRefresh={jira.refresh} refreshing={jira.busy} />
      <main className="mx-auto flex max-w-[1120px] flex-col gap-5 px-4 py-5 sm:px-6">
        {usingExampleConfig && (
          <Alert className="p-3 text-sm">
            <AlertTitle>Using the example configuration</AlertTitle>
            <AlertDescription>
              Copy <code className="font-mono">config/report.config.example.json</code> to <code className="font-mono">config/report.config.json</code>, add your roster and Jira details, then restart <code className="font-mono">npm start</code>.
            </AlertDescription>
          </Alert>
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

        {route === 'roster' && <RosterPage onRefresh={jira.refresh} refreshing={jira.busy} />}
        {route === 'capacity' && <CapacityPage />}
        {data && route === 'reports' && <ReportsPage data={data} />}
        {data && route === 'dashboard' && <Dashboard data={data} />}
      </main>
    </div>
  )
}
