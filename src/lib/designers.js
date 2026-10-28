import { shortName } from './report.js'

// Sorting, filtering and the saved layout for the designer cards on the Dashboard.
// Jira names look like "Doe, Jamie A" or "Roe, Alex (NonEmp)": last name first.

const clean = (name) => name.replace(/\s*\(.*?\)/g, '').trim()

export function lastName(name) {
  const parts = clean(name).split(',')
  return parts[0].trim()
}

const firstName = (name) => (clean(name).split(',')[1] ?? '').trim()
const cmp = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })

export const SORTS = {
  attention: 'Needs attention first',
  az: 'Last name A to Z',
  za: 'Last name Z to A',
}

/** Returns a new list. 'attention' keeps the order given (the report already puts blockers first). */
export function sortDesigners(list, mode) {
  if (mode !== 'az' && mode !== 'za') return [...list]
  const sorted = [...list].sort((a, b) => cmp(lastName(a.name), lastName(b.name)) || cmp(firstName(a.name), firstName(b.name)) || cmp(a.name, b.name))
  return mode === 'za' ? sorted.reverse() : sorted
}

/** Matches either name order, ignoring case: "doe", "jamie", "doe, ja" and "jamie do" all find "Doe, Jamie A". */
export function filterDesigners(list, text) {
  const q = (text ?? '').trim().toLowerCase()
  if (!q) return [...list]
  return list.filter((d) => [clean(d.name), shortName(d.name)].some((n) => n.toLowerCase().includes(q)))
}

const KEY = 'dar.view'
export const defaultView = () => ({ layout: 'grid', sort: 'attention' })

export function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    return {
      layout: v?.layout === 'list' ? 'list' : 'grid',
      sort: v?.sort in SORTS ? v.sort : 'attention',
    }
  } catch { /* storage unavailable or corrupt */ }
  return defaultView()
}

export function saveView(view) {
  try { localStorage.setItem(KEY, JSON.stringify(view)) } catch { /* ignore */ }
}
