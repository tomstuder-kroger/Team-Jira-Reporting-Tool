// Request checks shared by every local endpoint. The app only answers on localhost, and refuses
// requests that came from another web page (DNS rebinding and cross-site requests).

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/** null if the request may proceed, else { code, error }. */
export function checkLocal(req, { requireOrigin = false } = {}) {
  if (!LOCAL_HOST.test(req.headers.host ?? '')) return { code: 403, error: 'This service only answers on localhost.' }
  const origin = req.headers.origin
  if (origin) {
    let same = false
    try { same = new URL(origin).host === req.headers.host } catch { /* bad Origin header */ }
    if (!same) return { code: 403, error: 'Request origin not allowed.' }
  } else if (requireOrigin) {
    return { code: 403, error: 'Request origin not allowed.' }
  }
  return null
}

export function makeSend(res) {
  return (code, body) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(body))
  }
}

/** Reads a JSON request body of at most maxBytes. Rejects with { code, error } for anything else. */
export function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] ?? '')
    if (!/^application\/json\b/i.test(type)) return reject({ code: 415, error: 'Send JSON (Content-Type: application/json).' })
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) { reject({ code: 413, error: 'Request is too large.' }); req.destroy?.() } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject({ code: 400, error: 'The request was not valid JSON.' }) }
    })
    req.on('error', () => reject({ code: 400, error: 'The request could not be read.' }))
  })
}
