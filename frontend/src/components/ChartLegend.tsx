import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type BpCategory,
} from '../lib/bpCategory'
import { SERIES } from './chartSeries'

const ZONE_RANGES: Record<BpCategory, string> = {
  normal: 'below 120 / below 80',
  elevated: '120–129 / below 80',
  stage1: '130–139 or 80–89',
  stage2: '140 or higher, or 90 or higher',
}

/** Identifies the two lines and the reference bands, with the clinical caveat. */
export default function ChartLegend() {
  return (
    <div className="mt-3 space-y-2 text-sm text-slate-700">
      <ul aria-label="Lines" className="flex flex-wrap gap-x-4 gap-y-1">
        {(['systolic', 'diastolic'] as const).map((key) => (
          <li key={key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-5"
              style={{ backgroundColor: SERIES[key].color }}
            />
            {SERIES[key].name} (mmHg)
          </li>
        ))}
      </ul>
      <ul
        aria-label="Reference bands"
        className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2"
      >
        {(Object.keys(CATEGORY_LABELS) as BpCategory[]).map((category) => (
          <li key={category} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-sm border"
              style={{
                backgroundColor: `${CATEGORY_COLORS[category]}33`,
                borderColor: CATEGORY_COLORS[category],
              }}
            />
            <span>
              <span className="font-medium">{CATEGORY_LABELS[category]}</span>{' '}
              <span className="text-slate-600">({ZONE_RANGES[category]})</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-600">
        Background bands show the 2017 ACC/AHA blood pressure categories for
        reference only; they are not a diagnosis. A reading&apos;s category is
        the higher of its systolic and diastolic ones. Talk to a health
        professional about your readings.
      </p>
    </div>
  )
}
