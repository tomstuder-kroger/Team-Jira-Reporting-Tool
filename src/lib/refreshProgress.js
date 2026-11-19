// Turns the server's progress report into what the refresh banner shows. Pure, so it is tested without a browser.

/** { text, fraction } where fraction is 0 to 1, or null when the length of the step is not known. */
export function describeProgress(p) {
  if (!p) return { text: 'Starting the refresh…', fraction: null }
  if (p.phase === 'tickets') {
    const read = p.rows ?? 0
    return {
      text: `Reading tickets: ${read} read so far, ${p.done} of ${p.total} projects finished.`,
      fraction: p.total > 0 ? Math.min(p.done / p.total, 1) : null,
    }
  }
  if (p.phase === 'changed') {
    if (!p.total) return { text: 'No tickets have changed.', fraction: 1 }
    return { text: `Reading ${p.total} changed or new tickets: ${p.done} done.`, fraction: Math.min(p.done / p.total, 1) }
  }
  if (p.phase === 'check') return { text: 'Checking the ticket total against Jira…', fraction: null }
  if (p.phase === 'reconcile') return { text: 'Checking for tickets that moved or were removed…', fraction: null }
  if (p.phase === 'history') {
    if (!p.total) return { text: 'No status history needs re-reading.', fraction: 1 }
    return { text: `Reading status history: ${p.done} of ${p.total} changed tickets.`, fraction: Math.min(p.done / p.total, 1) }
  }
  return { text: 'Working…', fraction: null }
}

/** 0:07, 2:41, 1:02:03 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "$1.20 of $5.00 limit", or null when the server has not reported a cost. */
export function formatSpend(p) {
  if (!p || typeof p.costUsd !== 'number') return null
  const spent = `$${p.costUsd.toFixed(2)}`
  return typeof p.maxUsd === 'number' ? `${spent} of $${p.maxUsd.toFixed(2)} limit` : spent
}
