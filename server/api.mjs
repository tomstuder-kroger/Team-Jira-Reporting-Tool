import { ConfigError, JiraError, SetupError } from './errors.mjs'
import { runRefresh } from './run.mjs'

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/**
 * Connect-style middleware for POST /api/refresh. Localhost only: it rejects other Host headers
 * (DNS rebinding) and any cross-origin request. Repeated clicks share one Jira call.
 */
export function createRefreshHandler({ root, env, fetchImpl, minIntervalMs = 15000, clock = () => new Date() }) {
  let inflight = null
  let last = null

  return async function refreshHandler(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/refresh') return next()

    const send = (code, body) => {
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(body))
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return send(405, { ok: false, error: 'Use POST.' })
    }
    if (!LOCAL_HOST.test(req.headers.host ?? '')) return send(403, { ok: false, error: 'This service only answers on localhost.' })
    const origin = req.headers.origin
    if (origin) {
      let same = false
      try { same = new URL(origin).host === req.headers.host } catch { /* bad Origin header */ }
      if (!same) return send(403, { ok: false, error: 'Request origin not allowed.' })
    }

    try {
      if (inflight) return send(200, { ok: true, ...(await inflight), shared: true })
      if (last && clock().getTime() - last.at < minIntervalMs) return send(200, { ok: true, ...last.summary, skipped: true })

      inflight = runRefresh({ root, env, fetchImpl, now: clock() })
      let summary
      try {
        summary = await inflight
      } finally {
        inflight = null
      }
      last = { at: clock().getTime(), summary }
      return send(200, { ok: true, ...summary })
    } catch (err) {
      if (err instanceof SetupError) return send(503, { ok: false, error: err.message })
      if (err instanceof ConfigError) return send(500, { ok: false, error: err.message })
      if (err instanceof JiraError) return send(502, { ok: false, error: err.message })
      console.error('[refresh] unexpected error:', err?.message ?? err)
      return send(500, { ok: false, error: 'Refresh failed unexpectedly. The terminal running npm start has details.' })
    }
  }
}
