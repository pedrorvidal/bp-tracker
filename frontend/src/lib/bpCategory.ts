/**
 * Blood pressure categories of the 2017 ACC/AHA guideline, used for the
 * chart's reference bands. For reference only; not a diagnosis.
 */

export type BpCategory = 'normal' | 'elevated' | 'stage1' | 'stage2'

export const CATEGORY_LABELS: Record<BpCategory, string> = {
  normal: 'Normal',
  elevated: 'Elevated',
  stage1: 'Stage 1',
  stage2: 'Stage 2',
}

/**
 * Status palette (good / warning / serious / critical). Used only as faint
 * background tints, never for data lines, so the zones don't compete with
 * the series.
 */
export const CATEGORY_COLORS: Record<BpCategory, string> = {
  normal: '#0ca30c',
  elevated: '#fab219',
  stage1: '#ec835a',
  stage2: '#d03b3b',
}

/** Background opacity of the reference bands. */
export const ZONE_OPACITY = 0.12

export interface Zone {
  category: BpCategory
  /** Inclusive lower bound (mmHg); null = open-ended. */
  from: number | null
  /** Exclusive upper bound (mmHg); null = open-ended. */
  to: number | null
}

/** Systolic bands: <120, 120–129, 130–139, ≥140. */
export const SYSTOLIC_ZONES: Zone[] = [
  { category: 'normal', from: null, to: 120 },
  { category: 'elevated', from: 120, to: 130 },
  { category: 'stage1', from: 130, to: 140 },
  { category: 'stage2', from: 140, to: null },
]

/** Diastolic bands: <80, 80–89, ≥90 ("elevated" is systolic-only). */
export const DIASTOLIC_ZONES: Zone[] = [
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
