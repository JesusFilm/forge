/** Physical GA fetch provenance is separate from quota and receipt work. */
const physicalFailures = new WeakSet<object>()
const settledFailures = new WeakSet<object>()

const TRANSIENT_CAUSE_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
])

function isTransientNativeFetchFailure(
  error: unknown,
  signal: AbortSignal | null | undefined,
): error is TypeError {
  if (!(error instanceof TypeError) || signal?.aborted) return false
  const cause = error.cause
  return (
    cause instanceof Error &&
    typeof (cause as Error & { code?: unknown }).code === "string" &&
    TRANSIENT_CAUSE_CODES.has((cause as Error & { code: string }).code)
  )
}

/** Call only around the actual report fetch, after local admission. */
export async function fetchGaPhysical(
  resource: RequestInfo | URL,
  init?: RequestInit,
  physicalFetch: typeof fetch = fetch,
): Promise<Response> {
  try {
    return await physicalFetch(resource, init)
  } catch (error) {
    if (isTransientNativeFetchFailure(error, init?.signal))
      physicalFailures.add(error)
    throw error
  }
}

/** A physical failure becomes retryable only after its terminal receipt commits. */
export function settleGaPhysicalFailure(
  error: unknown,
  signal: AbortSignal | null | undefined,
): void {
  if (
    isTransientNativeFetchFailure(error, signal) &&
    physicalFailures.delete(error)
  )
    settledFailures.add(error)
}

export function takeSettledGaPhysicalFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if (!settledFailures.has(error)) return false
  settledFailures.delete(error)
  return true
}
