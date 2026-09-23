/**
 * Shapes shared with the bp-tracker REST API. Keep in sync with docs/api.md.
 */

/** A blood pressure reading, as returned by every /readings route. */
export interface Reading {
  id: number
  /** ISO 8601 date-time with offset, e.g. "2026-09-22T08:30:00+00:00". */
  reading_datetime: string
  /** mmHg, 60–250. */
  systolic: number
  /** mmHg, 40–150. */
  diastolic: number
  /** bpm, 30–220; null when not recorded. */
  pulse: number | null
  weight: number | null
  /** Empty string when not set. */
  notes: string
}

/** Body of POST /readings. */
export interface ReadingInput {
  reading_datetime: string
  systolic: number
  diastolic: number
  pulse?: number
  weight?: number
  notes?: string
}

/** Body of PUT /readings/{id}: any subset of the writable fields. */
export type ReadingUpdate = Partial<ReadingInput>

/** Query parameters accepted by GET /readings. */
export interface ReadingsQuery {
  page?: number
  per_page?: number
  period_start?: string
  period_end?: string
}

/** Response of GET /stats. Averages are null when there is no data. */
export interface ReadingStats {
  count: number
  systolic_average: number | null
  diastolic_average: number | null
  pulse_average: number | null
}

/** Response of POST /auth/login and POST /auth/refresh. */
export interface AuthTokens {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  /** Access token lifetime, in seconds. */
  expires_in: number
}

/** Standard WordPress REST error body. */
export interface ApiErrorResponse {
  code: string
  message: string
  data: {
    status: number
    params?: Record<string, string> | string[]
  }
}
