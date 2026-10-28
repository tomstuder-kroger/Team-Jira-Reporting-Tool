import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { issueUrl, shortName } from '@/lib/report'

export default function BlockerAlert({ blocked }) {
  if (!blocked.length) return null
  return (
    <Alert variant="destructive" className="border-destructive/40 bg-destructive/5 p-3 text-sm dark:bg-destructive/10">
      <AlertTitle className="text-[0.6875rem] font-semibold uppercase tracking-wider">
        Active blockers, action required ({blocked.length})
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {blocked.map(({ issue, owner, movedThisWeek, days }) => (
            <li key={issue.k} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-foreground">
              <span className="font-semibold">{shortName(owner.name)}</span>
              <a className="font-mono text-xs text-primary underline-offset-2 hover:underline dark:text-[oklch(0.75_0.12_261.6)]" href={issueUrl(issue.k)} target="_blank" rel="noreferrer">{issue.k}</a>
              <span>{issue.t}</span>
              {days !== null && days !== undefined && <span className="text-xs font-medium text-destructive">blocked {days === 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'}`}</span>}
              {!movedThisWeek && <span className="text-xs text-muted-foreground">No update in the last 7 days</span>}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
