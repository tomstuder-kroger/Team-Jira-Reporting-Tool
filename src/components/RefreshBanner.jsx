import { useEffect, useState } from 'react'
import { describeProgress, formatElapsed, formatSpend } from '@/lib/refreshProgress'

function Spinner() {
  return (
    <svg className="size-6 shrink-0 animate-spin text-primary motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** A bar that fills when the length of the step is known, and slides when it is not. */
function Bar({ fraction, label }) {
  const pct = fraction === null ? null : Math.round(fraction * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={pct === null ? 'in progress' : `${pct} percent`}
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
    >
      {pct === null
        ? <div className="dar-indeterminate h-full w-1/4 rounded-full bg-primary" />
        : <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />}
    </div>
  )
}

/**
 * Shown while a refresh runs: what it is doing, how far along, how long it has taken and what it has spent.
 * Sticks under the header so it stays in view when the page is scrolled.
 */
export default function RefreshBanner({ progress, startedAt }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { text, fraction } = describeProgress(progress)
  const spend = formatSpend(progress)

  return (
    <section aria-label="Refresh in progress" className="sticky top-16 z-40 flex flex-col gap-3 rounded-lg border border-primary/40 bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <Spinner />
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-extrabold leading-tight">Refreshing from Jira</h2>
          <p role="status" className="text-sm text-muted-foreground">{text}</p>
        </div>
        <dl className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {startedAt ? <div><dt className="sr-only">Elapsed</dt><dd>{formatElapsed(now - startedAt)} elapsed</dd></div> : null}
          {spend ? <div><dt className="sr-only">Spent</dt><dd>{spend}</dd></div> : null}
        </dl>
      </div>
      <Bar fraction={fraction} label="Refresh progress" />
      <p className="text-xs text-muted-foreground">
        The first refresh can take several minutes; later ones only re-read tickets that changed. You can keep using the page while this runs.
      </p>
    </section>
  )
}
