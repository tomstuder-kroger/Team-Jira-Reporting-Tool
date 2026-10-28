import { useEffect, useState } from 'react'

// Pages are chosen by the URL hash: #/reports, #/capacity, #/roster, anything else is the dashboard.
const ROUTES = { '#/reports': 'reports', '#/capacity': 'capacity', '#/roster': 'roster' }
const read = () => ROUTES[window.location.hash] ?? 'dashboard'

export function useRoute() {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => { setRoute(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
