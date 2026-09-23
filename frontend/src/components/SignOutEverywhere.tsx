import { useId, useState } from 'react'
import { useAuth } from '../hooks/useAuth'

/** Lets the user end every session on every device (e.g. after losing a phone). */
export default function SignOutEverywhere() {
  const { logoutEverywhere } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()
  const descriptionId = useId()

  async function handleClick() {
    setError(null)
    setPending(true)

    try {
      await logoutEverywhere()
      // Signed out: ProtectedRoute redirects to the login page.
    } catch {
      setError(
        'Could not sign out your other devices. Check your connection and try again.',
      )
      setPending(false)
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8 dark:border-slate-700 dark:bg-slate-900"
    >
      <h3 id={headingId} className="text-base font-semibold sm:text-lg">
        Security
      </h3>
      <p
        id={descriptionId}
        className="text-sm text-slate-700 dark:text-slate-300"
      >
        Signs you out on every device and browser where you are signed in,
        including this one.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending}
        aria-describedby={descriptionId}
        className="w-full rounded-md border border-red-700 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto dark:border-red-500 dark:text-red-300 dark:hover:bg-red-950/40 transition-colors duration-200"
      >
        {pending ? 'Signing out…' : 'Sign out of all devices'}
      </button>
    </section>
  )
}
