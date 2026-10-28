import { useEffect, useState } from 'react'

// Two pages, chosen by the URL hash: #/reports, anything else is the dashboard.
const read = () => (window.location.hash === '#/reports' ? 'reports' : 'dashboard')

export function useRoute() {
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = () => { setRoute(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
