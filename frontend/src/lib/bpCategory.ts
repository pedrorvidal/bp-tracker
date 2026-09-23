/**
 * Blood pressure categories of the 2017 ACC/AHA guideline. For reference
 * only; not a diagnosis.
 */

export type BpCategory = 'normal' | 'elevated' | 'stage1' | 'stage2'

export const CATEGORY_LABELS: Record<BpCategory, string> = {
  normal: 'Normal',
  elevated: 'Elevated',
  stage1: 'Stage 1',
  stage2: 'Stage 2',
}

/**
 * Status palette (good / warning / serious / critical), for category markers
 * (always next to the category name, never color alone).
 */
export const CATEGORY_COLORS: Record<BpCategory, string> = {
  normal: '#0ca30c',
  elevated: '#fab219',
  stage1: '#ec835a',
  stage2: '#d03b3b',
}

/** Upper bounds of the "normal" category, drawn as reference lines. */
export const NORMAL_SYSTOLIC_BELOW = 120
export const NORMAL_DIASTOLIC_BELOW = 80

interface Zone {
  category: BpCategory
  /** Inclusive lower bound (mmHg); null = open-ended. */
  from: number | null
  /** Exclusive upper bound (mmHg); null = open-ended. */
  to: number | null
}

/** Systolic thresholds: <120, 120–129, 130–139, ≥140. */
const SYSTOLIC_ZONES: Zone[] = [
  { category: 'normal', from: null, to: 120 },
  { category: 'elevated', from: 120, to: 130 },
  { category: 'stage1', from: 130, to: 140 },
  { category: 'stage2', from: 140, to: null },
]

/** Diastolic thresholds: <80, 80–89, ≥90 ("elevated" is systolic-only). */
const DIASTOLIC_ZONES: Zone[] = [
  { category: 'normal', from: null, to: 80 },
  { category: 'stage1', from: 80, to: 90 },
  { category: 'stage2', from: 90, to: null },
]

const ORDER: BpCategory[] = ['normal', 'elevated', 'stage1', 'stage2']

function zoneOf(value: number, zones: Zone[]): BpCategory {
  const zone = zones.find(
    (z) =>
      (z.from === null || value >= z.from) && (z.to === null || value < z.to),
  )
  return zone?.category ?? 'normal'
}

/**
 * A reading's category: the higher of its systolic and diastolic ones
 * (e.g. 118/85 is stage 1 because of the diastolic value).
 */
export function classify(systolic: number, diastolic: number): BpCategory {
  const bySystolic = zoneOf(systolic, SYSTOLIC_ZONES)
  const byDiastolic = zoneOf(diastolic, DIASTOLIC_ZONES)
  return ORDER.indexOf(bySystolic) >= ORDER.indexOf(byDiastolic)
    ? bySystolic
    : byDiastolic
}

/** How many readings fall in each category, in category order. */
export function categoryCounts(
  readings: ReadonlyArray<{ systolic: number; diastolic: number }>,
): Record<BpCategory, number> {
  const counts: Record<BpCategory, number> = {
    normal: 0,
    elevated: 0,
    stage1: 0,
    stage2: 0,
  }
  for (const reading of readings) {
    counts[classify(reading.systolic, reading.diastolic)] += 1
  }
  return counts
}

export const CATEGORY_ORDER: readonly BpCategory[] = ORDER
