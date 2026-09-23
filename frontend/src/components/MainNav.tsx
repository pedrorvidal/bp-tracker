import { NavLink } from 'react-router-dom'

const ITEMS = [
  {
    to: '/new',
    label: 'New reading',
    // Plus.
    icon: 'M12 5v14M5 12h14',
  },
  {
    to: '/history',
    label: 'History',
    // Trend line.
    icon: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  },
  {
    to: '/account',
    label: 'Account',
    // Person.
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  },
] as const

/**
 * Main navigation: a bar fixed to the bottom of the screen on mobile (within
 * thumb reach), and a row of links in the header from md up.
 */
export default function MainNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:static md:border-0 md:bg-transparent md:pb-0 dark:border-slate-700 dark:bg-slate-900"
    >
      <ul className="mx-auto grid max-w-7xl grid-cols-3 md:flex md:gap-2">
        {ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700 md:min-h-11 md:flex-row md:gap-2 md:rounded-md md:px-3 md:text-sm ${
                  isActive
                    ? 'text-blue-800 md:bg-blue-50 dark:text-blue-300 md:dark:bg-blue-950/50'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors duration-200'
                }`
              }
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-6 fill-none stroke-current stroke-2 md:size-5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={item.icon} />
              </svg>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
