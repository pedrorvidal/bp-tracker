import { useId, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import SessionLoading from '../components/SessionLoading'
import { useAuth } from '../hooks/useAuth'
import { isApiError } from '../lib/api'

/** Where to go after signing in: the page the user was sent away from, or home. */
function getRedirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const { from } = state
    if (typeof from === 'object' && from !== null && 'pathname' in from) {
      const { pathname } = from
      // Internal paths only.
      if (
        typeof pathname === 'string' &&
        pathname.startsWith('/') &&
        !pathname.startsWith('//')
      ) {
        return pathname
      }
    }
  }
  return '/'
}

function getErrorMessage(error: unknown): string {
  if (isApiError(error) && error.response?.status === 403) {
    return 'Invalid username or password.'
  }
  if (isApiError(error) && error.response?.status === 429) {
    const seconds = error.response.data.data.retry_after
    if (typeof seconds === 'number' && seconds > 0) {
      const minutes = Math.ceil(seconds / 60)
      return `Too many failed attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
    }
    return 'Too many failed attempts. Try again later.'
  }
  return 'Could not sign in. Check your connection and try again.'
}

export default function Login() {
  const { status, login } = useAuth()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const errorId = useId()

  if (status === 'loading') {
    return <SessionLoading />
  }

  if (status === 'authenticated') {
    return <Navigate to={getRedirectTarget(location.state)} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await login(username, password)
      // Signed in: the re-render above redirects.
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  const inputClass =
    'mt-1 block w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700'

  return (
    <section
      aria-labelledby="login-heading"
      className="mx-auto w-full sm:max-w-sm sm:rounded-lg sm:border sm:border-slate-200 sm:bg-white sm:p-8 sm:shadow-sm"
    >
      <h2 id="login-heading" className="text-xl font-semibold sm:text-2xl">
        Sign in
      </h2>

      <form
        className="mt-6 space-y-4"
        aria-labelledby="login-heading"
        onSubmit={(event) => void handleSubmit(event)}
        aria-describedby={error ? errorId : undefined}
      >
        {error && (
          <p
            id={errorId}
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}

        <div>
          <label
            htmlFor="login-username"
            className="block text-sm font-medium text-slate-800"
          >
            Username or email
          </label>
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-slate-800"
          >
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-700 px-4 py-2.5 text-base font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}
