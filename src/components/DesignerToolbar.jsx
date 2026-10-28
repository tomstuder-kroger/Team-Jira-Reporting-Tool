import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SORTS } from '@/lib/designers'
import { cn } from '@/lib/utils'

const FIELD =
  'h-8 rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

export default function DesignerToolbar({ view, onView, filter, onFilter, onExpandAll, onCollapseAll }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3" role="group" aria-label="Designer cards: layout, sort and filter">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="designer-filter">Filter by name</Label>
        <input
          id="designer-filter"
          type="search"
          autoComplete="off"
          className={cn(FIELD, 'w-48')}
          placeholder="Last or first name"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="designer-sort">Sort by</Label>
        <select id="designer-sort" className={cn(FIELD, 'min-w-44')} value={view.sort} onChange={(e) => onView({ ...view, sort: e.target.value })}>
          {Object.entries(SORTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium leading-none" id="layout-label">Layout</span>
        <div className="flex gap-1" role="group" aria-labelledby="layout-label">
          {[['grid', 'Grid'], ['list', 'List']].map(([id, label]) => (
            <Button key={id} size="lg" variant={view.layout === id ? 'default' : 'outline'} aria-pressed={view.layout === id} onClick={() => onView({ ...view, layout: id })}>{label}</Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium leading-none" id="details-label">Details</span>
        <div className="flex gap-1" role="group" aria-labelledby="details-label">
          <Button size="lg" variant="outline" onClick={onExpandAll}>Show all</Button>
          <Button size="lg" variant="outline" onClick={onCollapseAll}>Hide all</Button>
        </div>
      </div>
    </div>
  )
}
