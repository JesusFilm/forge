import { RecommendationRuntimeError } from "@/lib/recommendation-errors"

function isDefinitiveRecommendationStatus(status: number): boolean {
  return [400, 401, 403, 404, 409, 410, 422].includes(status)
}

export async function withinRecommendationDeadline<T>(
  externalSignal: AbortSignal | null | undefined,
  deadlineMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  else
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true })
  let timer: number | undefined
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => {
          controller.abort()
          reject(new RecommendationRuntimeError("deadline"))
        }, deadlineMs)
      }),
    ])
  } finally {
    if (timer != null) window.clearTimeout(timer)
    externalSignal?.removeEventListener("abort", abortFromCaller)
  }
}

export async function recommendationFetchWithDeadline(
  url: string,
  init: RequestInit,
  deadlineMs: number,
): Promise<Response> {
  return withinRecommendationDeadline(init.signal, deadlineMs, (signal) =>
    fetch(url, { ...init, signal }),
  )
}

export async function recommendationFetchWithRetry(
  url: string,
  init: RequestInit,
  deadlineMs: number,
  options: { attempts?: number; backoffMs?: number } = {},
): Promise<Response> {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 2))
  const backoffMs = Math.max(0, Math.min(1_000, options.backoffMs ?? 100))
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let definitive = false
    try {
      const response = await recommendationFetchWithDeadline(
        url,
        init,
        deadlineMs,
      )
      if (!response.ok) {
        definitive = isDefinitiveRecommendationStatus(response.status)
        throw new RecommendationRuntimeError("request_failed")
      }
      return response
    } catch (error) {
      lastError = error
      if (definitive) break
      if (attempt + 1 < attempts && backoffMs > 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, backoffMs)
        })
      }
    }
  }
  throw lastError
}

export async function recommendationJsonWithDeadline<T = unknown>(
  url: string,
  init: RequestInit,
  deadlineMs: number,
): Promise<T> {
  return withinRecommendationDeadline(
    init.signal,
    deadlineMs,
    async (signal) => {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) throw new RecommendationRuntimeError("request_failed")
      return response.json() as Promise<T>
    },
  )
}

export async function recommendationJsonWithRetry<T = unknown>(
  url: string,
  init: RequestInit,
  deadlineMs: number,
  options: {
    attempts?: number
    backoffMs?: number
    accept?: (value: T) => boolean
    onAttemptFailure?: (failure: {
      attempt: number
      reason: "response_invalid" | "transport" | "rejected"
      willRetry: boolean
    }) => void
  } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 2))
  const backoffMs = Math.max(0, Math.min(1_000, options.backoffMs ?? 100))
  return withinRecommendationDeadline(
    init.signal,
    deadlineMs,
    async (signal) => {
      let lastError: unknown
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let failureReason: "response_invalid" | "transport" | "rejected" =
          "transport"
        try {
          const response = await fetch(url, { ...init, signal })
          if (!response.ok) {
            if (isDefinitiveRecommendationStatus(response.status)) {
              failureReason = "rejected"
            }
            throw new RecommendationRuntimeError("request_failed")
          }
          const value = (await response.json()) as T
          if (options.accept && !options.accept(value)) {
            failureReason = "response_invalid"
            throw new RecommendationRuntimeError("request_failed")
          }
          return value
        } catch (error) {
          lastError = error
          const willRetry =
            failureReason !== "rejected" &&
            !signal.aborted &&
            attempt + 1 < attempts
          options.onAttemptFailure?.({
            attempt: attempt + 1,
            reason: failureReason,
            willRetry,
          })
          if (!willRetry) break
          if (backoffMs > 0) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, backoffMs * 2 ** attempt)
            })
          }
        }
      }
      throw lastError
    },
  )
}

export function randomRecommendationNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}

export function recommendationEventId(...parts: string[]) {
  return [...parts, randomRecommendationNonce()].join("-")
}
