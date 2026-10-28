import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { checkLabel } from '@/lib/capacity'
import { cn } from '@/lib/utils'

const FIELD =
  'h-8 min-w-0 flex-1 rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'

// A short list of names (portfolios or teams) that can be added to, renamed and removed.
export default function LabelList({ title, noun, items, onAdd, onRename, onRemove }) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(null) // { from, to }
  const [error, setError] = useState(null)

  const add = () => {
    const r = checkLabel(text, items)
    if (!r.ok) return setError(r.error)
    onAdd(r.name)
    setText('')
    setError(null)
  }
  const rename = () => {
    const r = checkLabel(editing.to, items, { keep: editing.from })
    if (!r.ok) return setError(r.error)
    if (r.name !== editing.from) onRename(editing.from, r.name)
    setEditing(null)
    setError(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title} ({items.length})</h3>
      {items.length === 0 && <p className="text-sm text-muted-foreground">No {noun}s yet.</p>}
      <ul className="flex flex-col divide-y" aria-label={title}>
        {items.map((name) => (
          <li key={name} className="flex items-center justify-between gap-2 py-1.5">
            {editing?.from === name ? (
              <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); rename() }}>
                <input aria-label={`New name for ${name}`} className={FIELD} value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} autoFocus />
                <Button type="submit" size="sm">Done</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(null); setError(null) }}>Cancel</Button>
              </form>
            ) : (
              <>
                <span className="min-w-0 truncate text-sm">{name}</span>
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" aria-label={`Rename ${name}`} onClick={() => { setEditing({ from: name, to: name }); setError(null) }}>Rename</Button>
                  <Button variant="ghost" size="sm" aria-label={`Remove ${name}`} onClick={() => onRemove(name)}>Remove</Button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
        <input aria-label={`New ${noun} name`} className={cn(FIELD)} placeholder={`New ${noun}`} value={text} onChange={(e) => { setText(e.target.value); setError(null) }} />
        <Button type="submit" variant="outline" size="lg">Add</Button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
