import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { api } from '../lib/api'
import type {
  ApiErrorResponse,
  Reading,
  ReadingInput,
  ReadingsQuery,
} from '../types'

/** One page of GET /readings, with the totals from the X-WP-Total* headers. */
export interface ReadingsPage {
  readings: Reading[]
  total: number
  totalPages: number
}

/** Query keys for readings, so every cache entry can be invalidated at once. */
export const readingsKeys = {
  all: ['readings'] as const,
  list: (query: ReadingsQuery) => ['readings', 'list', query] as const,
}

function headerNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Lists the signed-in user's readings (newest first). */
export function useReadings(
  query: ReadingsQuery = {},
): UseQueryResult<ReadingsPage, AxiosError<ApiErrorResponse>> {
  return useQuery({
    queryKey: readingsKeys.list(query),
    queryFn: async ({ signal }) => {
      const response = await api.get<Reading[]>('/readings', {
        params: query,
        signal,
      })

      return {
        readings: response.data,
        total: headerNumber(response.headers['x-wp-total']),
        totalPages: headerNumber(response.headers['x-wp-totalpages']),
      }
    },
  })
}

/** Creates a reading; refreshes every readings query on success. */
export function useCreateReading(): UseMutationResult<
  Reading,
  AxiosError<ApiErrorResponse>,
  ReadingInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ReadingInput) => {
      const { data } = await api.post<Reading>('/readings', input)
      return data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: readingsKeys.all }),
  })
}
