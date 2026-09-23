import { Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'

export default function App() {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
          <h1 className="text-lg font-bold sm:text-xl">BP Tracker</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
        </Routes>
      </main>
    </div>
  )
}
