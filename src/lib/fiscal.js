// Kroger fiscal calendar: 13 four-week periods a year, weeks run Sunday to Saturday.
// Quarters: Q1 = P1 to P4 (16 weeks), Q2 = P5 to P7, Q3 = P8 to P10, Q4 = P11 to P13 (12 weeks each).
//
// FY2026 was checked against Kroger's printed 2026 calendar, all 13 periods. FY2027 starts on
// Jan 31, 2027 (the day after FY2026 P13 ends) and is assumed to follow the same pattern. The
// reference app's calendar file shows 13-week quarters for FY2027, which contradicts FY2026, so
// confirm FY2027 against the printed calendar before relying on its quarters.
// Years after FY2027 are unknown here: fiscalPosition() returns null and the page hides the
// fiscal presets.

const DAY_MS = 864e5
const PERIOD_DAYS = 28
const PERIODS_PER_YEAR = 13
const YEAR_STARTS = { 2026: '2026-02-01', 2027: '2027-01-31' }
const QUARTER_FIRST_PERIOD = [0, 4, 7, 10] // zero-based index of each quarter's first period
const QUARTER_LAST_PERIOD = [3, 6, 9, 12]

// Whole-day arithmetic on UTC day numbers, so daylight saving never shifts a boundary.
const dayNumber = (y, m, d) => Math.floor(Date.UTC(y, m, d) / DAY_MS)
const isoToDayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return dayNumber(y, m - 1, d)
}
const dayNumberToLocal = (n) => {
  const u = new Date(n * DAY_MS)
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate())
}

/**
 * Where a date falls in the fiscal calendar, or null outside the known years.
 * Dates are local midnights; periodEnd and quarterEnd are the last day, inclusive.
 */
export function fiscalPosition(date) {
  const today = dayNumber(date.getFullYear(), date.getMonth(), date.getDate())
  for (const [year, startIso] of Object.entries(YEAR_STARTS)) {
    const start = isoToDayNumber(startIso)
    const offset = today - start
    if (offset < 0 || offset >= PERIODS_PER_YEAR * PERIOD_DAYS) continue
    const idx = Math.floor(offset / PERIOD_DAYS)
    const q = QUARTER_FIRST_PERIOD.findLastIndex((first) => idx >= first)
    return {
      year: Number(year),
      period: idx + 1,
      quarter: q + 1,
      periodStart: dayNumberToLocal(start + idx * PERIOD_DAYS),
      periodEnd: dayNumberToLocal(start + (idx + 1) * PERIOD_DAYS - 1),
      quarterStart: dayNumberToLocal(start + QUARTER_FIRST_PERIOD[q] * PERIOD_DAYS),
      quarterEnd: dayNumberToLocal(start + (QUARTER_LAST_PERIOD[q] + 1) * PERIOD_DAYS - 1),
    }
  }
  return null
}
