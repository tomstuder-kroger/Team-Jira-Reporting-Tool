import { useCallback, useEffect, useState } from 'react'

/**
 * The Refresh button's state: starts a refresh, shows its progress, and picks up one that is already running (for
 * example after the page was reloaded). Calls reload() when a refresh finishes so the page shows the new data.
 */
export function useJiraRefresh(reload) {
  // external: a refresh the server is running that this page did not start (for example the page was reloaded during one).
  const [state, setState] = useState({ busy: false, result: null, error: null, finishedAt: 0, progress: null, startedAt: null, external: false })

  const poll = useCallback(async () => {
    const res = await fetch('/api/refresh/status', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    return res.json()
  }, [])

  // On load, pick up a refresh that is already running, so a reload does not hide it.
  useEffect(() => {
    let live = true
    poll().then((body) => {
      if (live && body?.ok && body.busy) setState((s) => (s.busy ? s : { ...s, busy: true, external: true, progress: body.progress, startedAt: body.startedAt }))
    }).catch(() => { /* no refresh service: the Refresh button explains it */ })
    return () => { live = false }
  }, [poll])

  // While busy, ask the server how far along it is. The long refresh on the Atlassian MCP route can take minutes.
  useEffect(() => {
    if (!state.busy) return undefined
    let live = true
    const tick = async () => {
      try {
        const body = await poll()
        if (!live || !body?.ok) return
        if (body.busy) setState((s) => (s.busy ? { ...s, progress: body.progress, startedAt: s.startedAt ?? body.startedAt } : s))
        else if (state.external) { // the refresh we were watching has finished
          setState((s) => ({ ...s, busy: false, external: false, progress: null, startedAt: null, result: null, error: null, finishedAt: Date.now() }))
          reload()
        }
      } catch { /* the refresh request itself reports failures */ }
    }
    const id = setInterval(tick, 2000)
    return () => { live = false; clearInterval(id) }
  }, [state.busy, state.external, poll, reload])

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, external: false, result: null, error: null, progress: null, startedAt: Date.now() }))
    try {
      const res = await fetch('/api/refresh', { method: 'POST', headers: { Accept: 'application/json' } })
      let body = null
      try { body = await res.json() } catch { /* not JSON */ }
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || (res.status === 404 ? 'The refresh service is not running. Start the app with npm start.' : `Refresh failed (${res.status}).`))
      }
      await reload()
      setState({ busy: false, result: body, error: null, finishedAt: Date.now(), progress: null, startedAt: null, external: false })
    } catch (e) {
      setState((s) => ({ ...s, busy: false, external: false, progress: null, startedAt: null, result: null, error: e.message, finishedAt: Date.now() }))
    }
  }, [reload])

  return { ...state, refresh }
}
