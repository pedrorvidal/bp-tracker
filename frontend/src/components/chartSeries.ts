/**
 * Line colors. Categorical slots validated as a pair (CVD ΔE 13.0,
 * normal-vision ΔE 16.3, both >= 3:1 on white), and deliberately outside the
 * status hues used by the reference bands, so a line never blends into a
 * band (a red line on the red "stage 2" band would be invisible: ΔE 4.8).
 */
export const SERIES = {
  systolic: { name: 'Systolic', color: '#4a3aa7' },
  diastolic: { name: 'Diastolic', color: '#2a78d6' },
} as const

export const TEXT = '#334155' // slate-700
export const MUTED = '#475569' // slate-600
export const GRID = '#e2e8f0' // slate-200
