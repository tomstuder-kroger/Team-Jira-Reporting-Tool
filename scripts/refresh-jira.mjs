// Usage: npm run data:jira [-- --out path/to/file.json]
// Pulls from Jira with the credentials in .env and writes public/data/report.json (or --out).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRefresh } from '../server/run.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const i = args.indexOf('--out')
const outFile = i >= 0 ? path.resolve(args[i + 1]) : undefined

try {
  const s = await runRefresh({ root, env: process.env, outFile })
  console.log(`Wrote ${outFile ?? 'public/data/report.json'}`)
  console.log(`${s.tickets} tickets: ${s.open} open, ${s.closed} resolved in the last ${s.historyDays} days. Pulled ${s.pulledAt}.`)
  s.warnings.forEach((w) => console.warn('warning:', w))
} catch (e) {
  console.error('Refresh failed:', e.message)
  process.exit(1)
}
