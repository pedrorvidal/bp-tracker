import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiErrorResponse } from '../types'
import { getAccessToken } from './authTokens'

export const DEFAULT_API_URL = 'http://localhost:8888/wp-json/bp-tracker/v1'

export const API_URL: string = import.meta.env.VITE_API_URL || DEFAULT_API_URL

/** Pre-configured client for the bp-tracker/v1 namespace. */
export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

/** Adds "Authorization: Bearer <access_token>" when a token is available. */
export function attachAccessToken(
  config: InternalAxiosRequestConfig,
): InternalAxiosRequestConfig {
  const token = getAccessToken()

  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }

  return config
}

api.interceptors.request.use(attachAccessToken)

/** Narrows an unknown error to an API error that carries a WordPress REST error body. */
export function isApiError(
  error: unknown,
): error is AxiosError<ApiErrorResponse> {
  return (
    axios.isAxiosError<ApiErrorResponse>(error) &&
    typeof error.response?.data?.code === 'string'
  )
}
