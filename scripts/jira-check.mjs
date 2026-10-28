// Checks that the Jira credentials in .env work, and which base URL they work with.
// Usage: node --env-file=.env scripts/jira-check.mjs
// Prints status codes and non-secret fields only. The token and auth header are never printed.

import fs from 'node:fs'

const { JIRA_EMAIL, JIRA_API_TOKEN, JIRA_CLOUD_ID } = process.env
for (const [k, v] of Object.entries({ JIRA_EMAIL, JIRA_API_TOKEN, JIRA_CLOUD_ID })) {
  if (!v) {
    console.error(`${k} is not set. Run with: node --env-file=.env scripts/jira-check.mjs`)
    process.exit(1)
  }
}

const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')
const siteUrl = JSON.parse(fs.readFileSync('config/report.config.json', 'utf8')).siteUrl
const BASES = {
  'scoped gateway': `https://api.atlassian.com/ex/jira/${JIRA_CLOUD_ID}`,
  'site (classic)': siteUrl,
}

async function call(base, path) {
  const res = await fetch(base + path, { headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  let body = null
  try { body = await res.json() } catch { /* not JSON */ }
  return { status: res.status, body }
}

const short = (b) => {
  const m = b?.message || b?.errorMessages?.[0] || b?.error || ''
  return String(m).slice(0, 140)
}

let working = null
console.log('Step 1: who am I  (GET /rest/api/3/myself)')
for (const [label, base] of Object.entries(BASES)) {
  try {
    const { status, body } = await call(base, '/rest/api/3/myself')
    const detail = status === 200 ? `ok, signed in as "${body.displayName}"` : short(body)
    console.log(`  ${label.padEnd(15)} ${status}  ${detail}`)
    if (status === 200 && !working) working = [label, base]
  } catch (e) {
    console.log(`  ${label.padEnd(15)} failed: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`)
  }
}

if (!working) {
  console.log('\nNo base URL accepted these credentials. 401 means a wrong email or token; 403 means the token or a Kroger policy blocks it.')
  process.exit(2)
}
console.log(`\nWorking base: ${working[0]}`)
