import type { ChartTheme } from './chartSeries'
import { SERIES_NAMES } from './chartSeries'

const chipClass =
  'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'

/** The chart's legend as chips: one per line, plus the dashed normal limits. */
export default function LegendChips({ theme }: { theme: ChartTheme }) {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-2">
      {(['systolic', 'diastolic'] as const).map((key) => (
        <li key={key} className={chipClass}>
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: theme[key] }}
          />
          {SERIES_NAMES[key]}
        </li>
      ))}
      <li className={chipClass}>
        <svg aria-hidden="true" width="18" height="4" className="shrink-0">
          <line
            x1="0"
            y1="2"
            x2="18"
            y2="2"
            stroke={theme.muted}
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        </svg>
        Normal limits (&lt;120 / &lt;80)
      </li>
    </ul>
  )
}
