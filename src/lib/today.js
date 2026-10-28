import { useEffect, useState } from 'react'

// Today's date, kept current: re-read when the tab becomes visible again and once a minute, so a
// dashboard left open overnight moves to the new fiscal period or week without a reload.
export function useToday() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow((prev) => {
      const next = new Date()
      return next.toDateString() === prev.toDateString() ? prev : next
    })
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [])
  return now
}
