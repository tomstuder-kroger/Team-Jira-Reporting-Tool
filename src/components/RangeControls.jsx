import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// Same field styling as the reference app's Input, applied to native controls so no extra package is needed.
const FIELD =
  'h-8 rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

const GROUPS = [
  ['Rolling, from the last refresh', ['last7', 'last14', 'last30']],
  ['Calendar', ['week', 'lastweek']],
  ['Fiscal', ['period', 'lastperiod', 'quarter', 'lastquarter', 'fytd']],
]

export default function RangeControls({ win, range, onChange }) {
  const custom = win.id === 'custom'
  const keep = { compare: range.compare ?? 'off' }
  const byId = Object.fromEntries(win.presets.map((p) => [p.id, p]))
  const opt = win.compareOption

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="range-select">Date range</Label>
        <select
          id="range-select"
          className={cn(FIELD, 'min-w-48')}
          value={win.id}
          onChange={(e) => {
            const id = e.target.value
            onChange(id === 'custom' ? { id, since: win.sinceDay, until: null, ...keep } : { id, since: null, until: null, ...keep })
          }}
        >
          {GROUPS.map(([label, ids]) => {
            const items = ids.map((id) => byId[id]).filter(Boolean)
            return items.length === 0 ? null : (
              <optgroup key={label} label={label}>
                {items.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.disabled} title={p.reason}>
                    {p.label}{p.disabled ? (p.reason?.startsWith('This range starts after') ? ' (no data yet)' : ' (not enough saved data)') : ''}
                  </option>
                ))}
              </optgroup>
            )
          })}
          <optgroup label="Other">
            <option value="custom">Custom dates…</option>
          </optgroup>
        </select>
      </div>

      {custom && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="range-since">From</Label>
            <input
              id="range-since"
              type="date"
              className={FIELD}
              min={win.minDay}
              max={win.maxDay}
              value={win.sinceDay}
              onChange={(e) => e.target.value && onChange({ id: 'custom', since: e.target.value, until: range.until, ...keep })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="range-until">To</Label>
            <input
              id="range-until"
              type="date"
              className={FIELD}
              min={win.sinceDay}
              max={win.maxDay}
              value={win.untilDay}
              onChange={(e) => e.target.value && onChange({ id: 'custom', since: range.since ?? win.sinceDay, until: e.target.value, ...keep })}
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="compare-select">Compare with</Label>
        <select
          id="compare-select"
          className={cn(FIELD, 'min-w-44')}
          value={opt.ok ? (range.compare ?? 'off') : 'off'}
          onChange={(e) => onChange({ ...range, compare: e.target.value })}
          title={opt.ok ? undefined : opt.reason}
        >
          <option value="off">Nothing</option>
          <option value="previous" disabled={!opt.ok}>
            {win.prev === 'period' ? 'Previous period' : win.prev === 'quarter' ? 'Previous quarter' : 'Previous range'}{opt.ok ? '' : ' (not enough saved data)'}
          </option>
        </select>
      </div>
    </div>
  )
}
