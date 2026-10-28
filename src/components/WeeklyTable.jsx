const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const signed = (n) => (n > 0 ? `+${n}` : String(n))

export default function WeeklyTable({ weeks }) {
  const rows = [...weeks].reverse() // newest first
  const done = weeks.filter((w) => !w.partial)
  const sum = (key, list) => list.reduce((a, w) => a + w[key], 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm tabular-nums">
        <caption className="sr-only">Tickets opened and closed per week</caption>
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">Week</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Opened</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Closed</th>
            <th scope="col" className="py-2 pl-3 text-right font-medium" title="Opened minus closed. Positive means the backlog grew.">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.label} className="border-b last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                {fmt(w.start)} to {fmt(new Date(w.end.getFullYear(), w.end.getMonth(), w.end.getDate() - (w.partial ? 0 : 1)))}
                {w.partial && <span className="ml-2 text-xs text-muted-foreground">to date</span>}
              </th>
              <td className="px-3 py-2 text-right">{w.opened}</td>
              <td className="px-3 py-2 text-right">{w.closed}</td>
              <td className="py-2 pl-3 text-right text-muted-foreground">{signed(w.net)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <th scope="row" className="py-2 pr-3 text-left">Complete weeks ({done.length})</th>
            <td className="px-3 py-2 text-right">{sum('opened', done)}</td>
            <td className="px-3 py-2 text-right">{sum('closed', done)}</td>
            <td className="py-2 pl-3 text-right">{signed(sum('net', done))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
