import { BucketBadge } from '@/components/StatusBadge'
import { shortName } from '@/lib/report'

export default function QuietTable({ quiet }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="bg-muted text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <th className="px-3.5 py-2.5 font-medium">Designer</th>
            <th className="px-3.5 py-2.5 font-medium">Status</th>
            <th className="px-3.5 py-2.5 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {quiet.length === 0 && (
            <tr><td colSpan={3} className="px-3.5 py-3 text-muted-foreground">Every designer had activity this week.</td></tr>
          )}
          {quiet.map((d) => (
            <tr key={d.name} className="border-t align-top">
              <td className="whitespace-nowrap px-3.5 py-2.5 font-semibold">{shortName(d.name)}</td>
              <td className="px-3.5 py-2.5"><BucketBadge bucket="open">No activity</BucketBadge></td>
              <td className="px-3.5 py-2.5">{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
