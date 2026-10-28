import { shortName } from '@/lib/report'

// One bar per designer. Solid = assigned to them, lighter = paired (assigned to someone else).
export default function ClosedByDesigner({ data }) {
  const { rows, none, max } = data
  const shown = rows.filter((r) => r.total > 0)

  return (
    <div className="flex flex-col gap-3">
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tickets were closed in these weeks.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Tickets closed per designer">
          {shown.map((r) => (
            <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-x-3 text-sm">
              <span className="truncate" title={r.name}>{shortName(r.name)}</span>
              <span className="flex h-3.5 overflow-hidden rounded-sm bg-muted" role="img" aria-label={`${r.assigned} assigned, ${r.paired} paired`}>
                <span className="bg-success" style={{ width: `${(r.assigned / max) * 100}%` }} />
                <span className="bg-success/40" style={{ width: `${(r.paired / max) * 100}%` }} />
              </span>
              <span className="text-right text-xs tabular-nums">
                <b className="text-sm">{r.total}</b>
                {r.paired > 0 && <span className="text-muted-foreground"> ({r.assigned} + {r.paired} paired)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-success" />Assigned</span>
        <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-success/40" />Paired</span>
        {none > 0 && <span>{none} tracked {none === 1 ? 'designer' : 'designers'} closed nothing.</span>}
      </div>
    </div>
  )
}
