import axios, { type AxiosError } from 'axios'
import type { ApiErrorBody } from './contracts'

const DEFAULT_TIMEOUT_MS = 4000

function readTimeout(): number {
  const value = Number(import.meta.env.VITE_API_TIMEOUT_MS)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: readTimeout(),
  headers: { Accept: 'application/json' },
})

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'canceled' | 'unknown'

/** Normalised failure of an API call, so the UI never has to inspect Axios internals. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }

  /** Client errors (4xx) will fail the same way again; everything else is worth a retry. */
  get retryable(): boolean {
    if (this.kind === 'canceled') return false
    if (this.kind === 'http') {
      return this.status !== null && (this.status >= 500 || this.status === 408 || this.status === 429)
    }
    return true
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (axios.isCancel(error)) return new ApiError('canceled', 'The request was cancelled.')
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorBody>
    if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
      return new ApiError('timeout', 'The server took too long to answer.')
    }
    if (axiosError.response) {
      const { status, data } = axiosError.response
      const detail =
        typeof data?.message === 'string' ? data.message : `Request failed (HTTP ${status}).`
      return new ApiError('http', detail, status)
    }
    return new ApiError('network', 'Could not reach the server. Check your connection.')
  }
  return new ApiError('unknown', error instanceof Error ? error.message : 'Unexpected error.')
}

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(toApiError(error)),
)
