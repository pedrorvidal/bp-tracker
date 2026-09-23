import SignOutEverywhere from '../components/SignOutEverywhere'
import { useAuth } from '../hooks/useAuth'

export default function HomePage() {
  const { user } = useAuth()

  return (
    <div className="space-y-6">
      <section aria-labelledby="home-heading" className="space-y-2">
        <h2 id="home-heading" className="text-xl font-semibold sm:text-2xl">
          Welcome{user ? `, ${user.displayName}` : ''}
        </h2>
        <p className="text-slate-700">Track your blood pressure readings.</p>
      </section>
      <SignOutEverywhere />
    </div>
  )
}
