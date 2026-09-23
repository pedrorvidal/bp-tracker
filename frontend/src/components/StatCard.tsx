import type { ReactNode } from 'react'

export interface Change {
  /** Current minus previous, rounded to one decimal. */
  delta: number
  unit: string
  previousLabel: string
}

interface StatCardProps {
  label: string
  value: string
  unit?: string
  /** Secondary line, e.g. min and max. */
  detail?: string
  /** Change vs the previous period; omitted when there's nothing to compare. */
  change?: Change | null
  /**
   * "lowerIsBetter": a drop shows green and a rise red (blood pressure).
   * "neutral": no judgement color (pulse).
   */
  tone?: 'lowerIsBetter' | 'neutral'
  children?: ReactNode
}

/**
 * The change in words, split so the key part ("6.8 mmHg higher") can lead on
 * narrow cards; read together it is one sentence.
 */
function changeText({ delta, unit, previousLabel }: Change) {
  const amount = Math.abs(delta).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })
  const context = `the ${previousLabel}`
  if (delta === 0) return { arrow: '=', lead: 'Same as', context }
  return delta > 0
    ? { arrow: '↑', lead: `${amount} ${unit} higher than`, context }
    : { arrow: '↓', lead: `${amount} ${unit} lower than`, context }
}

function changeColor(delta: number, tone: 'lowerIsBetter' | 'neutral') {
  if (tone === 'neutral' || delta === 0) {
    return 'text-slate-600 dark:text-slate-400'
  }
  return delta < 0
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-red-700 dark:text-red-400'
}

/** One headline statistic as a small card. */
export default function StatCard({
  label,
  value,
  unit,
  detail,
  change,
  tone = 'neutral',
  children,
}: StatCardProps) {
  const described = change ? changeText(change) : null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:p-8 dark:border-slate-700 dark:bg-slate-900">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-2">
        <span className="text-3xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
          {value}
        </span>
        {/* A real space, so a long value can wrap before the unit. */}
        {unit && ' '}
        {unit && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {unit}
          </span>
        )}
        {detail && (
          <span className="mt-1 block text-sm text-slate-500 tabular-nums dark:text-slate-400">
            {detail}
          </span>
        )}
        {change && described && (
          <span
            className="mt-2 block text-sm"
            data-change={
              change.delta < 0 ? 'down' : change.delta > 0 ? 'up' : 'same'
            }
          >
            <span
              className={`block font-medium tabular-nums ${changeColor(change.delta, tone)}`}
            >
              <span aria-hidden="true">{described.arrow} </span>
              {described.lead}
            </span>{' '}
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {described.context}
            </span>
          </span>
        )}
        {children}
      </dd>
    </div>
  )
}
