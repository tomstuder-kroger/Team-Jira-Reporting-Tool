import fs from 'node:fs'
import path from 'node:path'
import { ConfigError } from './errors.mjs'
import { checkLocal, makeSend, readJson } from './guard.mjs'

// The plan for team capacity: portfolios, teams, and per person per fiscal quarter time off and
// allocation percentages. It is typed in on the Capacity page and saved to config/capacity.json, which
// is git-ignored (real names). This file is the only thing it writes, and it never calls Jira.

const MAX_LABELS = 40
const MAX_PEOPLE = 60
const MAX_NAME = 60
const MAX_QUARTERS = 12
const MAX_TEAMS_PER_PERSON = 10
const QUARTER_KEY = /^FY\d{4}-Q[1-4]$/
const BAD_CHAR = /[\u0000-\u001f"\\]/

export const capacityPath = (root) => path.join(root, 'config/capacity.json')
export const emptyCapacity = () => ({ portfolios: [], teams: [], people: {} })

const label = (v, what) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  if (!s) throw new ConfigError(`A ${what} name is empty.`)
  if (s.length > MAX_NAME) throw new ConfigError(`A ${what} name is too long.`)
  if (BAD_CHAR.test(s)) throw new ConfigError(`"${s.slice(0, 30)}" contains a character that is not allowed.`)
  return s
}

function labelList(list, what) {
  if (!Array.isArray(list)) throw new ConfigError(`The ${what} list is missing.`)
  if (list.length > MAX_LABELS) throw new ConfigError(`There can be at most ${MAX_LABELS} ${what}s.`)
  const seen = new Set()
  return list.map((raw) => {
    const s = label(raw, what)
    if (seen.has(s.toLowerCase())) throw new ConfigError(`${s} is listed twice.`)
    seen.add(s.toLowerCase())
    return s
  })
}

/** Validates the whole plan and returns a clean copy, or throws ConfigError. */
export function cleanCapacity(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('The capacity plan is not in the expected shape.')
  const portfolios = labelList(input.portfolios, 'portfolio')
  const teams = labelList(input.teams, 'team')
  const people = {}
  const entries = Object.entries(input.people && typeof input.people === 'object' && !Array.isArray(input.people) ? input.people : {})
  if (entries.length > MAX_PEOPLE) throw new ConfigError(`There can be at most ${MAX_PEOPLE} people.`)

  for (const [rawName, p] of entries) {
    const name = label(rawName, 'person')
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ConfigError(`${name} is not in the expected shape.`)
    const out = {}
    // A person can be on several teams. The older single `team` value is read as a list of one.
    const given = Array.isArray(p.teams) ? p.teams : p.team ? [p.team] : []
    if (given.length > MAX_TEAMS_PER_PERSON) throw new ConfigError(`${name} is on too many teams.`)
    if (given.some((t) => typeof t !== 'string' || !teams.includes(t))) throw new ConfigError(`${name} is on a team that is not in the team list.`)
    if (new Set(given).size !== given.length) throw new ConfigError(`${name} is on the same team twice.`)
    if (given.length) out.teams = given

    const timeOff = p.timeOff ?? {}
    if (typeof timeOff !== 'object' || Array.isArray(timeOff) || Object.keys(timeOff).length > MAX_QUARTERS) throw new ConfigError(`${name} has time off in an unexpected shape.`)
    const t = {}
    for (const [k, v] of Object.entries(timeOff)) {
      if (!QUARTER_KEY.test(k)) throw new ConfigError(`"${k.slice(0, 20)}" is not a fiscal quarter such as FY2026-Q4.`)
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 20) throw new ConfigError(`${name}'s time off must be a number of weeks from 0 to 20.`)
      if (v > 0) t[k] = Math.round(v * 100) / 100
    }
    if (Object.keys(t).length) out.timeOff = t

    const allocations = p.allocations ?? {}
    if (typeof allocations !== 'object' || Array.isArray(allocations) || Object.keys(allocations).length > MAX_QUARTERS) throw new ConfigError(`${name} has allocations in an unexpected shape.`)
    const a = {}
    for (const [k, byPortfolio] of Object.entries(allocations)) {
      if (!QUARTER_KEY.test(k)) throw new ConfigError(`"${k.slice(0, 20)}" is not a fiscal quarter such as FY2026-Q4.`)
      if (!byPortfolio || typeof byPortfolio !== 'object' || Array.isArray(byPortfolio)) throw new ConfigError(`${name} has allocations in an unexpected shape.`)
      const q = {}
      for (const [pf, v] of Object.entries(byPortfolio)) {
        if (!portfolios.includes(pf)) throw new ConfigError(`${name} has a percentage on a portfolio that is not in the portfolio list.`)
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) throw new ConfigError(`${name}'s percentages must be whole numbers from 0 to 100.`)
        if (v > 0) q[pf] = v
      }
      if (Object.keys(q).length) a[k] = q
    }
    if (Object.keys(a).length) out.allocations = a
    people[name] = out
  }
  return { portfolios, teams, people }
}

/** The saved plan, or an empty one if nothing has been saved yet. */
export function readCapacity(root) {
  const file = capacityPath(root)
  if (!fs.existsSync(file)) return { capacity: emptyCapacity(), saved: false }
  try {
    return { capacity: cleanCapacity(JSON.parse(fs.readFileSync(file, 'utf8'))), saved: true }
  } catch (e) {
    throw new ConfigError(`config/capacity.json could not be read: ${e instanceof ConfigError ? e.message : 'it is not valid JSON'} Fix or remove the file.`)
  }
}

/** Writes the plan, keeping the previous file as capacity.backup.json, through a temp file and a rename. */
export function saveCapacity(root, input) {
  const capacity = cleanCapacity(input)
  const file = capacityPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.copyFileSync(file, file.replace(/\.json$/, '.backup.json'))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(capacity, null, 2) + '\n')
  fs.renameSync(tmp, file)
  return capacity
}

/**
 * Connect-style middleware: GET /api/capacity (the plan) and PUT /api/capacity (replace it).
 * Localhost only, same-origin, JSON only. Never reaches Jira.
 */
export function createCapacityHandler({ root }) {
  return async function capacityHandler(req, res, next) {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/capacity') return next()

    const send = makeSend(res)
    const write = req.method === 'PUT'
    const denied = checkLocal(req, { requireOrigin: write })
    if (denied) return send(denied.code, { ok: false, error: denied.error })
    if (req.method !== 'GET' && req.method !== 'PUT') {
      res.setHeader('Allow', 'GET, PUT')
      return send(405, { ok: false, error: 'Use GET or PUT.' })
    }

    try {
      if (!write) return send(200, { ok: true, ...readCapacity(root) })
      const body = await readJson(req, 128 * 1024)
      return send(200, { ok: true, saved: true, capacity: saveCapacity(root, body?.capacity) })
    } catch (err) {
      if (err && typeof err.code === 'number' && typeof err.error === 'string') return send(err.code, { ok: false, error: err.error })
      if (err instanceof ConfigError) return send(400, { ok: false, error: err.message })
      console.error('[capacity] unexpected error:', err?.message ?? err)
      return send(500, { ok: false, error: 'The request failed unexpectedly. The terminal running npm start has details.' })
    }
  }
}
