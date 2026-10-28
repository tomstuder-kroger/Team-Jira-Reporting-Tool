// Calls to the local capacity endpoint (server/capacity.mjs). The plan holds names and percentages only.

async function call(init) {
  let res
  try {
    res = await fetch('/api/capacity', init)
  } catch {
    throw new Error('Could not reach the local service. Is npm start running?')
  }
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || (res.status === 404 ? 'The capacity service is not running. Start the app with npm start.' : `Request failed (${res.status}).`))
  }
  return body
}

export const fetchCapacity = () => call({ headers: { Accept: 'application/json' }, cache: 'no-store' })

export const saveCapacity = (capacity) =>
  call({ method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ capacity }) })
