import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import ProtectedRoute, { LOGIN_PATH } from './components/ProtectedRoute'
import { useAuth } from './hooks/useAuth'
import Account from './pages/Account'
import Login from './pages/Login'
import NewReading from './pages/NewReading'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
    isActive ? 'bg-blue-50 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
  }`

export default function App() {
  const { isAuthenticated, user, logout } = useAuth()

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <h1 className="text-lg font-bold sm:text-xl">BP Tracker</h1>
          {isAuthenticated && (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-700 sm:inline">
                {user?.displayName}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Sign out
              </button>
            </div>
          )}
          {isAuthenticated && (
            <nav aria-label="Main" className="w-full">
              <ul className="flex gap-2">
                <li>
                  <NavLink to="/new" className={navLinkClass}>
                    New reading
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/account" className={navLinkClass}>
                    Account
                  </NavLink>
                </li>
              </ul>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path={LOGIN_PATH} element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/new" element={<NewReading />} />
            <Route path="/account" element={<Account />} />
          </Route>
          {/* No dashboard yet: the home page is the new-reading form. */}
          <Route path="/" element={<Navigate to="/new" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
