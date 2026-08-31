import { RecommendationRuntimeError } from "@/lib/recommendation-errors"

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
    try {
      const response = await recommendationFetchWithDeadline(
        url,
        init,
        deadlineMs,
      )
      if (!response.ok) {
        throw new RecommendationRuntimeError("request_failed")
      }
      return response
    } catch (error) {
      lastError = error
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
