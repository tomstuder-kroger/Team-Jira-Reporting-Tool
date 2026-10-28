import config from './config.js'
import { fiscalPosition } from './fiscal.js'

// A range always ends at the moment of the last Jira pull. Jira keeps only a ticket's latest
// update time, so a range ending earlier would miss tickets touched since. Ranges start at a
// rolling offset from the pull ("last 7 days") or at a local midnight (fiscal period, custom date).

const DAY_MS = 864e5
const pad = (n) => String(n).padStart(2, '0')
const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const fmtFull = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export const toIsoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 'YYYY-MM-DD' to a local midnight Date, or null if it is not a real calendar date. */
export function parseIsoDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null
}

export function buildPresets(anchor, historyStart) {
  const list = [7, 14, 30].map((n) => ({
    id: `last${n}`,
    label: `Last ${n} days`,
    start: new Date(anchor.getTime() - n * DAY_MS),
    within: `in the last ${n} days`,
  }))
  const pos = fiscalPosition(anchor)
  if (pos) {
    list.push({ id: 'period', label: `This period (P${pos.period})`, start: pos.periodStart, within: `in this fiscal period (P${pos.period})` })
    list.push({ id: 'quarter', label: `This quarter (Q${pos.quarter})`, start: pos.quarterStart, within: `in this fiscal quarter (Q${pos.quarter})` })
  }
  return list.map((p) => {
    const tooEarly = p.start < historyStart
    return { ...p, disabled: tooEarly, reason: tooEarly ? `The saved data only goes back to ${fmtFull(historyStart)}.` : undefined }
  })
}

/**
 * range: { id, since } as chosen on the page. Returns the window to use, always valid.
 * An unknown or unavailable choice falls back to the first preset.
 */
export function resolveWindow(range, anchor, historyStart) {
  const presets = buildPresets(anchor, historyStart)
  // The earliest custom day is the first full local day after the history starts, because tickets
  // resolved earlier that day were not pulled.
  const hs = startOfDay(historyStart)
  const min = new Date(hs.getFullYear(), hs.getMonth(), hs.getDate() + 1)
  const max = startOfDay(anchor)

  let chosen = null
  let note = null
  if (range?.id === 'custom') {
    const parsed = parseIsoDay(range.since) ?? startOfDay(presets[0].start)
    let start = parsed
    if (start < min) { start = min; note = `The saved data starts ${fmtShort(min)}, so the range starts there.` }
    if (start > max) { start = max; note = `Latest start date is ${fmtShort(max)}.` }
    chosen = { id: 'custom', label: 'Custom', start, within: `since ${fmtShort(start)}` }
  } else {
    chosen = presets.find((p) => p.id === range?.id && !p.disabled) ?? presets[0]
  }
  return { ...chosen, end: anchor, note, presets, sinceDay: toIsoDay(chosen.start), minDay: toIsoDay(min), maxDay: toIsoDay(max) }
}

export const windowLabel = (win) => `${fmtShort(win.start)} to ${fmtFull(win.end)}`

const KEY = 'dar.range'
export const defaultRange = () => ({ id: config.defaultRange, since: null })

export function loadRange() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    if (v && typeof v.id === 'string') return { id: v.id, since: typeof v.since === 'string' ? v.since : null }
  } catch { /* storage unavailable or corrupt */ }
  return defaultRange()
}

export function saveRange(range) {
  try { localStorage.setItem(KEY, JSON.stringify(range)) } catch { /* ignore */ }
}
