import type {
  AuthSession,
  AuthTokensResponse,
  Reading,
  ReadingStats,
} from '../types'

/** A token response as returned by /auth/login and /auth/refresh. */
export function makeTokensResponse(
  label = 'a',
  userId = 1,
): AuthTokensResponse {
  return {
    access_token: `access-${label}`,
    token_type: 'Bearer',
    expires_in: 3600,
    user: { id: userId, username: 'admin', display_name: 'Ada Admin' },
  }
}

/** A signed-in session. */
export function makeSession(label = 'a', userId = 1): AuthSession {
  return {
    tokens: {
      accessToken: `access-${label}`,
      expiresAt: Date.now() + 3_600_000,
    },
    user: { id: userId, username: 'admin', displayName: 'Ada Admin' },
  }
}

/**
 * n readings over consecutive days from 2026-06-01, `perDay` per day, spread
 * between 08:00 and 22:00 so they always stay within their day.
 */
export function manyReadings(n: number, perDay = 3): Reading[] {
  const step = Math.max(1, Math.floor(14 / perDay))
  return Array.from({ length: n }, (_, i) => {
    const when = new Date(
      2026,
      5,
      1 + Math.floor(i / perDay),
      8 + (i % perDay) * step,
    )
    return {
      id: i + 1,
      reading_datetime: when.toISOString(),
      systolic: 110 + (i % 30),
      diastolic: 70 + (i % 20),
      pulse: 60 + (i % 10),
      weight: null,
      notes: '',
    }
  })
}

/** GET /stats body; every statistic null and count 0 unless overridden. */
export function makeStats(overrides: Partial<ReadingStats> = {}): ReadingStats {
  return {
    count: 0,
    systolic_average: null,
    diastolic_average: null,
    pulse_average: null,
    systolic_min: null,
    systolic_max: null,
    diastolic_min: null,
    diastolic_max: null,
    pulse_min: null,
    pulse_max: null,
    ...overrides,
  }
}
