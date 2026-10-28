// Usage: npm run data:merge
// Reads data-raw/pool.json (rows from the Atlassian MCP route), writes public/data/report.json.
// The Refresh from Jira button and `npm run data:jira` do not need this; they query Jira directly.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeReport } from './merge-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) {
    console.error(`Missing ${rel}. See the refresh steps in README.md.`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

const config = read('config/report.config.json')
const pool = read('data-raw/pool.json')

const { data, warnings } = mergeReport({ pool, config, now: new Date().toISOString() })
warnings.forEach((w) => console.warn('warning:', w))

fs.mkdirSync(path.join(root, 'public/data'), { recursive: true })
fs.writeFileSync(path.join(root, 'public/data/report.json'), JSON.stringify(data, null, 1))

const closed = data.tickets.filter((t) => t.r).length
console.log(`Wrote public/data/report.json: ${data.tickets.length} tickets (${data.tickets.length - closed} open, ${closed} resolved in the last ${config.historyDays} days), pulled ${data.meta.pulledAt}.`)
