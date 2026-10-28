import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import example from '../config/capacity.example.json'
import { cleanCapacity, readCapacity, saveCapacity, createCapacityHandler, emptyCapacity } from './capacity.mjs'
import { ConfigError } from './errors.mjs'

const GOOD = { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }
const Q = 'FY2026-Q4'
const base = () => ({ portfolios: ['Portfolio A', 'Portfolio B'], teams: ['Team One'], people: { 'Doe, Jamie': { teams: ['Team One'], timeOff: { [Q]: 2 }, allocations: { [Q]: { 'Portfolio A': 60 } } } } })
const mkRoot = () => { const r = fs.mkdtempSync(path.join(os.tmpdir(), 'dar-cap-')); fs.mkdirSync(path.join(r, 'config')); return r }
const file = (root) => path.join(root, 'config/capacity.json')
const bad = (mutate, re) => { const c = base(); mutate(c); expect(() => cleanCapacity(c)).toThrow(re) }

const call = async (handler, { method = 'GET', url = '/api/capacity', headers = { host: '127.0.0.1:5173' }, body } = {}) => {
  const req = Object.assign(new PassThrough(), { method, url, headers })
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b ? JSON.parse(b) : null } }
  let nexted = false
  const done = handler(req, res, () => { nexted = true })
  req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))
  await done
  return { res, nexted }
}

describe('the committed example', () => {
  it('is valid and contains only made-up names', () => {
    expect(() => cleanCapacity(example)).not.toThrow()
    expect(JSON.stringify(example)).toMatch(/Portfolio A/)
  })
})

describe('cleanCapacity', () => {
  it('keeps a good plan, trims names, drops zero percentages and zero time off', () => {
    const c = base()
    c.people['Doe, Jamie'].allocations[Q]['Portfolio B'] = 0
    c.people['Doe, Jamie'].timeOff['FY2026-Q3'] = 0
    c.portfolios = ['  Portfolio   A ', 'Portfolio B']
    c.people['Doe, Jamie'].allocations[Q] = { 'Portfolio B': 0 }
    expect(cleanCapacity(c).portfolios).toEqual(['Portfolio A', 'Portfolio B'])
    expect(cleanCapacity(c).people['Doe, Jamie']).toEqual({ teams: ['Team One'], timeOff: { [Q]: 2 } })
  })
  it('rejects percentages that are not whole numbers from 0 to 100', () => {
    for (const v of [101, -1, 2.5, '50', null, NaN, Infinity]) bad((c) => { c.people['Doe, Jamie'].allocations[Q]['Portfolio A'] = v }, /whole numbers from 0 to 100/)
  })
  it('rejects bad time off, quarter keys, and shapes', () => {
    for (const v of [-1, 21, '2', NaN]) bad((c) => { c.people['Doe, Jamie'].timeOff[Q] = v }, /time off must be/)
    bad((c) => { c.people['Doe, Jamie'].timeOff.nope = 1 }, /fiscal quarter/)
    bad((c) => { c.people['Doe, Jamie'].allocations['FY2026-Q9'] = {} }, /fiscal quarter/)
    bad((c) => { c.people['Doe, Jamie'].allocations[Q] = [] }, /unexpected shape/)
    bad((c) => { c.people['Doe, Jamie'] = 'x' }, /expected shape/)
    for (const x of [null, [], 'x', 5]) expect(() => cleanCapacity(x)).toThrow(ConfigError)
    expect(() => cleanCapacity({ teams: [], people: {} })).toThrow(/portfolio list is missing/)
  })
  it('rejects names with quotes, control characters, blanks, duplicates in any letter case, and long names', () => {
    bad((c) => { c.portfolios.push('Bad"Name') }, /not allowed/)
    bad((c) => { c.teams.push('Bad\u0007') }, /not allowed/)
    bad((c) => { c.portfolios.push('   ') }, /empty/)
    bad((c) => { c.portfolios.push('portfolio a') }, /twice/)
    bad((c) => { c.portfolios.push('x'.repeat(61)) }, /too long/)
    bad((c) => { c.people['Bad"Person'] = {} }, /not allowed/)
  })
  it('rejects a team or portfolio that is not in the lists, and counts over the limits', () => {
    bad((c) => { c.people['Doe, Jamie'].teams = ['Ghost'] }, /not in the team list/)
    bad((c) => { c.people['Doe, Jamie'].teams = ['Team One', 'Ghost'] }, /not in the team list/)
    bad((c) => { c.people['Doe, Jamie'].teams = [5] }, /not in the team list/)
    bad((c) => { c.people['Doe, Jamie'].allocations[Q] = { Ghost: 10 } }, /not in the portfolio list/)
    bad((c) => { c.portfolios = Array.from({ length: 41 }, (_, i) => `P${i}`) }, /at most 40/)
    bad((c) => { c.people = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`N${i}, X`, {}])) }, /at most 60/)
  })
  it('does not let a person named __proto__ change the result for everyone else', () => {
    const c = JSON.parse('{"portfolios":[],"teams":[],"people":{"__proto__":{"team":""},"A, Ann":{}}}')
    const out = cleanCapacity(c)
    expect(Object.keys(out.people)).toContain('A, Ann')
    expect({}.team).toBeUndefined()
  })
})

describe('several teams per person', () => {
  const two = () => { const c = base(); c.teams = ['Team One', 'Team Two']; return c }
  it('accepts a person on several teams, and reads the older single team as a list of one', () => {
    const c = two(); c.people['Doe, Jamie'].teams = ['Team One', 'Team Two']
    expect(cleanCapacity(c).people['Doe, Jamie'].teams).toEqual(['Team One', 'Team Two'])
    const old = two(); delete old.people['Doe, Jamie'].teams; old.people['Doe, Jamie'].team = 'Team Two'
    const out = cleanCapacity(old).people['Doe, Jamie']
    expect(out.teams).toEqual(['Team Two'])
    expect('team' in out).toBe(false)
  })
  it('rejects the same team twice and too many teams for one person', () => {
    bad((c) => { c.people['Doe, Jamie'].teams = ['Team One', 'Team One'] }, /same team twice/)
    bad((c) => { c.teams = Array.from({ length: 11 }, (_, i) => `T${i}`); c.people['Doe, Jamie'].teams = c.teams.slice() }, /too many teams/)
  })
})

describe('reading and saving', () => {
  it('reads an empty plan, not an error, when nothing is saved yet', () => {
    expect(readCapacity(mkRoot())).toEqual({ capacity: emptyCapacity(), saved: false })
  })
  it('saves, backs up the previous file, leaves no temp file, and reads back', () => {
    const root = mkRoot()
    saveCapacity(root, base())
    expect(fs.existsSync(path.join(root, 'config/capacity.backup.json'))).toBe(false) // nothing to back up the first time
    const next = base(); next.people['Doe, Jamie'].allocations[Q]['Portfolio B'] = 30
    saveCapacity(root, next)
    expect(JSON.parse(fs.readFileSync(path.join(root, 'config/capacity.backup.json'), 'utf8')).people['Doe, Jamie'].allocations[Q]).toEqual({ 'Portfolio A': 60 })
    expect(fs.readdirSync(path.join(root, 'config')).sort()).toEqual(['capacity.backup.json', 'capacity.json'])
    expect(readCapacity(root)).toEqual({ capacity: cleanCapacity(next), saved: true })
  })
  it('leaves the file untouched when validation fails', () => {
    const root = mkRoot()
    saveCapacity(root, base())
    const before = fs.readFileSync(file(root), 'utf8')
    expect(() => saveCapacity(root, { ...base(), portfolios: ['A', 'a'] })).toThrow()
    expect(fs.readFileSync(file(root), 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(root, 'config/capacity.backup.json'))).toBe(false)
  })
  it('says the file is damaged instead of crashing or silently overwriting it', () => {
    const root = mkRoot()
    fs.writeFileSync(file(root), '{not json')
    expect(() => readCapacity(root)).toThrow(/could not be read/)
    fs.writeFileSync(file(root), JSON.stringify({ portfolios: ['A'], teams: [], people: { X: { allocations: { [Q]: { A: 500 } } } } }))
    expect(() => readCapacity(root)).toThrow(/whole numbers/)
  })
})

describe('the /api/capacity endpoint', () => {
  it('passes other paths through', async () => {
    expect((await call(createCapacityHandler({ root: mkRoot() }), { url: '/api/roster' })).nexted).toBe(true)
  })
  it('GET returns the plan, or an empty one flagged as not saved', async () => {
    const root = mkRoot()
    const h = createCapacityHandler({ root })
    expect((await call(h)).res.body).toEqual({ ok: true, capacity: emptyCapacity(), saved: false })
    saveCapacity(root, base())
    expect((await call(h)).res.body.saved).toBe(true)
  })
  it('PUT saves and returns the clean plan', async () => {
    const root = mkRoot()
    const { res } = await call(createCapacityHandler({ root }), { method: 'PUT', headers: GOOD, body: { capacity: base() } })
    expect(res.statusCode).toBe(200)
    expect(res.body.capacity.people['Doe, Jamie'].teams).toEqual(['Team One'])
    expect(fs.existsSync(file(root))).toBe(true)
  })
  it('rejects foreign hosts and origins, a PUT with no Origin, the wrong content type, bad JSON, and oversized bodies, without writing', async () => {
    const root = mkRoot()
    const h = createCapacityHandler({ root })
    const body = { capacity: base() }
    expect((await call(h, { headers: { host: 'evil.example.com' } })).res.statusCode).toBe(403)
    expect((await call(h, { method: 'PUT', headers: { ...GOOD, origin: 'https://evil.example.com' }, body })).res.statusCode).toBe(403)
    expect((await call(h, { method: 'PUT', headers: { host: '127.0.0.1:5173', 'content-type': 'application/json' }, body })).res.statusCode).toBe(403)
    expect((await call(h, { method: 'PUT', headers: { ...GOOD, 'content-type': 'text/plain' }, body: 'x' })).res.statusCode).toBe(415)
    expect((await call(h, { method: 'PUT', headers: GOOD, body: '{nope' })).res.statusCode).toBe(400)
    expect((await call(h, { method: 'PUT', headers: GOOD, body: JSON.stringify({ capacity: { ...base(), portfolios: ['x'.repeat(200 * 1024)] } }) })).res.statusCode).toBe(413)
    expect((await call(h, { method: 'PUT', headers: GOOD, body: { capacity: { ...base(), portfolios: ['A', 'a'] } } })).res.statusCode).toBe(400)
    expect(fs.existsSync(file(root))).toBe(false)
  })
  it('rejects other methods and carries no credentials in any answer', async () => {
    const h = createCapacityHandler({ root: mkRoot() })
    expect((await call(h, { method: 'POST' })).res.statusCode).toBe(405)
    const ok = await call(h)
    expect(JSON.stringify(ok.res.body)).not.toMatch(/token|password|secret|@/i)
  })
})
