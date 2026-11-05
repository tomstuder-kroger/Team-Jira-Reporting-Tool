// Validation of the optional `workload` block in config/report.config.json. Pure, no imports, so the
// refresh (server/queries.mjs) and the Workload page (src/lib/workload.js) check the same rules.
//
// Overrides are checked for their values only, not for whether the name is still on the roster.
// Returns { ok: true, value } with defaults filled in, or { ok: false, absent, reason }.
// `absent` is true only when the block is not there at all (not configured), as opposed to wrong.

const FIELD = /^customfield_\d+$/

export const DEFAULT_SIZE_DAYS = { XS: 1.5, SM: 5, MED: 10, LG: 20, XL: 30 }
const DEFAULT_EXCLUDED = ['Epic', 'Program Epic']

const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0
const fraction = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
const dayCount = (n) => positive(n) && n <= 5

export function checkWorkloadConfig(w) {
  if (w === undefined || w === null) {
    return { ok: false, absent: true, reason: 'The workload block is missing from config/report.config.json.' }
  }
  const bad = (reason) => ({ ok: false, absent: false, reason })
  if (typeof w !== 'object' || Array.isArray(w)) return bad('workload must be an object.')

  if (!FIELD.test(w.sizeFieldId ?? '')) return bad('workload.sizeFieldId must look like customfield_12345.')
  if (!FIELD.test(w.rankFieldId ?? '')) return bad('workload.rankFieldId must look like customfield_12345.')

  // The start-date field is optional: without it a ticket has a due date but no start.
  if (w.startFieldId !== undefined && !FIELD.test(w.startFieldId)) return bad('workload.startFieldId must look like customfield_12345.')

  const sizeDays = w.sizeDays ?? DEFAULT_SIZE_DAYS
  if (typeof sizeDays !== 'object' || Array.isArray(sizeDays) || Object.keys(sizeDays).length === 0) {
    return bad('workload.sizeDays must map each size label to a number of days.')
  }
  if (!Object.values(sizeDays).every(positive)) return bad('Every workload.sizeDays value must be a positive number.')

  const daysPerWeek = w.daysPerWeek ?? 5
  if (!dayCount(daysPerWeek)) return bad('workload.daysPerWeek must be a number above 0 and up to 5.')
  // 40 hours a week, Monday to Friday: 5 days at 100% focus. Lower `focus` for part-time or split-project people.
  const focus = w.focus ?? 1
  if (!fraction(focus)) return bad('workload.focus must be a number from 0 to 1.')

  const overrides = w.overrides ?? {}
  if (typeof overrides !== 'object' || Array.isArray(overrides)) return bad('workload.overrides must be an object keyed by roster name.')
  // A name that is no longer on the roster is ignored, not rejected: removing someone on the Roster page
  // must not make the next refresh fail because of a leftover override.
  for (const o of Object.values(overrides)) {
    if (!o || typeof o !== 'object') return bad('Each workload.overrides entry must be an object.')
    if (o.focus !== undefined && !fraction(o.focus)) return bad('An override focus must be a number from 0 to 1.')
    if (o.daysPerWeek !== undefined && !dayCount(o.daysPerWeek)) return bad('An override daysPerWeek must be a number above 0 and up to 5.')
  }

  const excludedTypes = w.excludedTypes ?? DEFAULT_EXCLUDED
  if (!Array.isArray(excludedTypes) || !excludedTypes.every((t) => typeof t === 'string')) {
    return bad('workload.excludedTypes must be a list of issue type names.')
  }

  return {
    ok: true,
    value: { sizeFieldId: w.sizeFieldId, rankFieldId: w.rankFieldId, startFieldId: w.startFieldId ?? null, sizeDays, daysPerWeek, focus, overrides, excludedTypes },
  }
}
