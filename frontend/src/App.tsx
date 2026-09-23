import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute, { LOGIN_PATH } from './components/ProtectedRoute'
import { useAuth } from './hooks/useAuth'
import HomePage from './pages/HomePage'
import Login from './pages/Login'

export default function App() {
  const { isAuthenticated, user, logout } = useAuth()

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <h1 className="text-lg font-bold sm:text-xl">BP Tracker</h1>
          {isAuthenticated && (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-700 sm:inline">
                {user?.username}
              </span>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path={LOGIN_PATH} element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<HomePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
