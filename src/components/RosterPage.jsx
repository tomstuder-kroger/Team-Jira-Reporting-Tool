import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import KdsNotice from '@/components/KdsNotice'
import { usingExampleConfig } from '@/lib/config'
import { shortName } from '@/lib/report'
import { fetchRoster, rememberSaved, saveRoster, searchPeople, takeSaved } from '@/lib/rosterApi'
import { cn } from '@/lib/utils'

const FIELD =
  'h-8 w-full rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

const list = (names) => names.map(shortName).join(', ')
const savedMessage = ({ added, removed }) => {
  const parts = []
  if (added.length) parts.push(`Added ${list(added)}.`)
  if (removed.length) parts.push(`Removed ${list(removed)}.`)
  if (!parts.length) parts.push('The roster was already up to date.')
  if (added.length) parts.push('Their tickets appear after the next refresh from Jira.')
  return `Roster saved. ${parts.join(' ')}`
}

export default function RosterPage({ onRefresh, refreshing }) {
  const [saved, setSaved] = useState(null) // names as stored in the config file
  const [loadError, setLoadError] = useState(null)
  const [removed, setRemoved] = useState(() => new Set())
  const [added, setAdded] = useState([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ status: 'idle', people: [], error: null })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [notice] = useState(takeSaved)
  const seq = useRef(0)

  useEffect(() => {
    let live = true
    fetchRoster().then((r) => live && setSaved(r)).catch((e) => live && setLoadError(e.message))
    return () => { live = false }
  }, [])

  // Search Jira as the user types, after a short pause. Stale answers are ignored.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults({ status: 'idle', people: [], error: null }); return undefined }
    const ctl = new AbortController()
    const id = ++seq.current
    const timer = setTimeout(async () => {
      setResults((r) => ({ ...r, status: 'loading', error: null }))
      try {
        const people = await searchPeople(q, ctl.signal)
        if (id === seq.current) setResults({ status: 'done', people, error: null })
      } catch (e) {
        if (e.name !== 'AbortError' && id === seq.current) setResults({ status: 'error', people: [], error: e.message })
      }
    }, 350)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [query])

  const working = useMemo(() => (saved ? [...saved.filter((n) => !removed.has(n)), ...added] : []), [saved, removed, added])
  const dirty = removed.size > 0 || added.length > 0
  const tracked = useMemo(() => new Set(working), [working])

  const add = useCallback((name) => {
    if (saved?.includes(name)) setRemoved((r) => { const n = new Set(r); n.delete(name); return n }) // re-adding a removed person undoes it
    else setAdded((a) => (a.includes(name) ? a : [...a, name]))
    setQuery('')
  }, [saved])

  const discard = () => { setRemoved(new Set()); setAdded([]); setSaveError(null) }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const result = await saveRoster(working)
      rememberSaved(result)
      window.location.reload() // every page reads the roster at load, so reload to apply it everywhere
    } catch (e) {
      setSaveError(e.message)
      setSaving(false)
    }
  }

  const canSave = dirty && working.length > 0 && !saving && !usingExampleConfig

  return (
    <>
      <div>
        <h1 className="font-heading text-2xl font-extrabold">Roster</h1>
        <p className="text-sm text-muted-foreground">Who the dashboard and reports track. Names must match Jira exactly, so add people by searching Jira.</p>
      </div>

      {usingExampleConfig && (
        <Alert className="p-3 text-sm">
          <AlertTitle>Using the example configuration</AlertTitle>
          <AlertDescription>The roster can only be saved once <code className="font-mono">config/report.config.json</code> exists. Copy the example to that name first, then restart <code className="font-mono">npm start</code>.</AlertDescription>
        </Alert>
      )}

      {notice && (
        <div className="flex flex-wrap items-center gap-3">
          <KdsNotice className="max-w-3xl flex-1">{savedMessage(notice)}</KdsNotice>
          {notice.added.length > 0 && onRefresh && (
            <Button variant="outline" size="lg" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh from Jira'}</Button>
          )}
        </div>
      )}

      {(loadError || saveError) && (
        <Alert variant="destructive" className="p-3 text-sm">
          <AlertTitle>{loadError ? 'Could not load the roster' : 'The roster was not saved'}</AlertTitle>
          <AlertDescription>{loadError || saveError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-3.5">
        <Card>
          <CardHeader>
            <CardTitle>Tracked designers ({working.length})</CardTitle>
            <CardDescription>{dirty ? 'unsaved changes' : 'saved'}</CardDescription>
          </CardHeader>

          {saved === null && !loadError && <p className="text-sm text-muted-foreground">Loading…</p>}

          {saved && (
            <ul className="flex flex-col divide-y" aria-label="Tracked designers">
              {saved.map((name) => {
                const gone = removed.has(name)
                return (
                  <li key={name} className="flex items-center justify-between gap-3 py-2">
                    <span className={cn('min-w-0', gone && 'text-muted-foreground line-through')}>
                      <span className="block truncate font-medium">{shortName(name)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{name}</span>
                    </span>
                    {gone ? (
                      <Button variant="outline" size="sm" onClick={() => setRemoved((r) => { const n = new Set(r); n.delete(name); return n })}>Undo</Button>
                    ) : (
                      <Button variant="ghost" size="sm" aria-label={`Remove ${shortName(name)}`} onClick={() => setRemoved((r) => new Set(r).add(name))}>Remove</Button>
                    )}
                  </li>
                )
              })}
              {added.map((name) => (
                <li key={name} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{shortName(name)} <span className="ml-1 text-xs font-normal text-success">new</span></span>
                    <span className="block truncate text-xs text-muted-foreground">{name}</span>
                  </span>
                  <Button variant="ghost" size="sm" aria-label={`Cancel adding ${shortName(name)}`} onClick={() => setAdded((a) => a.filter((n) => n !== name))}>Cancel</Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="lg" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save roster'}</Button>
            <Button variant="outline" size="lg" onClick={discard} disabled={!dirty || saving}>Discard changes</Button>
            {dirty && working.length === 0 && <span className="text-xs text-destructive">The roster cannot be empty.</span>}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add a designer</CardTitle>
            <CardDescription>searches Jira by name</CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="roster-search">Name</Label>
            <input
              id="roster-search"
              type="search"
              autoComplete="off"
              className={FIELD}
              placeholder="Start typing a first or last name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!saved}
            />
          </div>

          <div aria-live="polite" className="min-h-6 text-sm">
            {results.status === 'loading' && <p className="text-muted-foreground">Searching Jira…</p>}
            {results.status === 'error' && <p className="text-destructive">{results.error}</p>}
            {results.status === 'done' && results.people.length === 0 && <p className="text-muted-foreground">No active people matched. Try fewer letters.</p>}
            {results.status === 'idle' && query.trim().length > 0 && <p className="text-muted-foreground">Type at least 2 letters.</p>}
          </div>

          {results.status === 'done' && results.people.length > 0 && (
            <ul className="flex flex-col divide-y rounded-md border" aria-label="Search results">
              {results.people.map((name) => {
                const already = tracked.has(name)
                return (
                  <li key={name} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">{name}</span>
                    {already ? <span className="text-xs text-muted-foreground">Already tracked</span> : <Button variant="outline" size="sm" onClick={() => add(name)}>Add</Button>}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Two people can share a name. Check the full name shown here against Jira before saving. Only names are kept, never emails or IDs.</p>
        </Card>
      </div>

      <footer className="pt-1 text-center text-xs text-muted-foreground">
        Saving rewrites only the roster in <code className="font-mono">config/report.config.json</code> on this computer and keeps the previous version in <code className="font-mono">report.config.backup.json</code>. Nothing is changed in Jira. Removing someone hides them straight away; adding someone needs a refresh from Jira to pull their tickets.
      </footer>
    </>
  )
}
