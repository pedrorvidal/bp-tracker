import { useAuth } from '../hooks/useAuth'

export default function HomePage() {
  const { user } = useAuth()

  return (
    <section aria-labelledby="home-heading" className="space-y-2">
      <h2 id="home-heading" className="text-xl font-semibold sm:text-2xl">
        Welcome{user ? `, ${user.username}` : ''}
      </h2>
      <p className="text-slate-700">Track your blood pressure readings.</p>
    </section>
  )
}
