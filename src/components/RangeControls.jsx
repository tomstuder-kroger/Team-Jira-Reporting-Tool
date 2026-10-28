import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// Same field styling as the reference app's Input, applied to native controls so no extra package is needed.
const FIELD =
  'h-8 rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

export default function RangeControls({ win, onChange }) {
  const custom = win.id === 'custom'
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="range-select">Date range</Label>
        <select
          id="range-select"
          className={cn(FIELD, 'min-w-44')}
          value={win.id}
          onChange={(e) => {
            const id = e.target.value
            onChange(id === 'custom' ? { id, since: win.minDay > win.maxDay ? win.maxDay : toDay(win) } : { id, since: null })
          }}
        >
          {win.presets.map((p) => (
            <option key={p.id} value={p.id} disabled={p.disabled} title={p.reason}>
              {p.label}{p.disabled ? ' (not enough saved data)' : ''}
            </option>
          ))}
          <option value="custom">Custom start date…</option>
        </select>
      </div>

      {custom && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="range-since">Since</Label>
          <input
            id="range-since"
            type="date"
            className={FIELD}
            min={win.minDay}
            max={win.maxDay}
            value={win.sinceDay}
            onChange={(e) => e.target.value && onChange({ id: 'custom', since: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}

function toDay(win) {
  return win.sinceDay
}
