import KpiStrip from '@/components/KpiStrip'

const days = (n) => (n === null ? 'n/a' : `${n} d`)

export default function BlockedTiles({ b }) {
  const kpis = [
    { id: 'now', value: b.currentCount, label: 'Blocked now', hint: 'open tickets in a Blocked status', tone: 'destructive' },
    { id: 'longest', value: days(b.longestCurrentDays), label: 'Longest current block', hint: 'days since it was blocked' },
    { id: 'median', value: days(b.medianDays), label: 'Median days blocked', hint: `${b.finishedCount} block${b.finishedCount === 1 ? '' : 's'} that ended in these weeks` },
  ]
  return <KpiStrip kpis={kpis} />
}
