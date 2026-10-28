import { useEffect, useState } from 'react'

const logo = '/kroger-logo.svg'

// Same treatment as the "Shared Services Support" action in capacity-planning-app's GlobalNavBar:
// plain white semibold text, no fill, a faint white wash on hover. Focus and disabled states added.
const NAV_ACTION =
  'cursor-pointer whitespace-nowrap rounded border-none bg-transparent px-2 py-2 text-sm font-semibold text-white transition-colors ' +
  'hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ' +
  'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent sm:px-4'

const PAGES = [
  { id: 'dashboard', label: 'Dashboard', href: '#/' },
  { id: 'reports', label: 'Reports', href: '#/reports' },
  { id: 'roster', label: 'Roster', href: '#/roster' },
]

function initialDark() {
  try {
    const saved = localStorage.getItem('theme')
    if (saved) return saved === 'dark'
  } catch { /* storage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function Header({ route = 'dashboard', onRefresh, refreshing = false }) {
  const [dark, setDark] = useState(initialDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [dark])

  return (
    <header className="sticky top-0 z-50 flex h-14 w-full shrink-0 items-center justify-between gap-3 bg-primary px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <img src={logo} alt="Kroger" className="h-[33px] w-[60px] shrink-0 object-contain" />
        <span className="truncate text-base font-normal leading-6 text-white sm:text-xl">PD Designer Activity Report</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <nav aria-label="Pages" className="flex items-center gap-1 sm:gap-2">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={p.href}
              className={`${NAV_ACTION} ${route === p.id ? 'underline decoration-2 underline-offset-8' : ''}`}
              aria-current={route === p.id ? 'page' : undefined}
            >
              {p.label}
            </a>
          ))}
        </nav>
        {onRefresh && (
          <button
            type="button"
            className={NAV_ACTION}
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
            aria-label={refreshing ? 'Refreshing from Jira' : 'Refresh from Jira'}
          >
            {refreshing ? 'Refreshing…' : <>Refresh<span className="hidden sm:inline">&nbsp;from Jira</span></>}
          </button>
        )}
        <button type="button" className={NAV_ACTION} aria-pressed={dark} onClick={() => setDark((d) => !d)}>
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
    </header>
  )
}
