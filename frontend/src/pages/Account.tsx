import SignOutEverywhere from '../components/SignOutEverywhere'
import { useAuth } from '../hooks/useAuth'

export default function Account() {
  const { user } = useAuth()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section aria-labelledby="account-heading" className="space-y-1">
        <h2 id="account-heading" className="text-xl font-semibold sm:text-2xl">
          Account
        </h2>
        {user && (
          <p className="text-slate-700 dark:text-slate-300">
            Signed in as {user.displayName} ({user.username})
          </p>
        )}
      </section>
      <SignOutEverywhere />
    </div>
  )
}
