/**
 * Chart colors per color scheme. Series are the categorical red and blue,
 * validated as a pair on each card surface (light on white: CVD ΔE 21.6,
 * normal-vision 32.3; dark on slate-900: 19.2 / 29.0; all >= 3:1). Text
 * never uses series colors.
 */
export interface ChartTheme {
  systolic: string
  diastolic: string
  text: string
  muted: string
  grid: string
  surface: string
}

export const LIGHT: ChartTheme = {
  systolic: '#e34948',
  diastolic: '#2a78d6',
  text: '#334155', // slate-700
  muted: '#64748b', // slate-500
  grid: '#e2e8f0', // slate-200
  surface: '#ffffff',
}

export const DARK: ChartTheme = {
  systolic: '#e66767',
  diastolic: '#3987e5',
  text: '#cbd5e1', // slate-300
  muted: '#94a3b8', // slate-400
  grid: '#334155', // slate-700
  surface: '#0f172a', // slate-900
}

export const SERIES_NAMES = {
  systolic: 'Systolic',
  diastolic: 'Diastolic',
} as const
