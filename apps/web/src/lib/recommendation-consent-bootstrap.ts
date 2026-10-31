let bootstrapPromise: Promise<void> | null = null
let resolveBootstrap: (() => void) | null = null
let fallbackLock: Promise<void> = Promise.resolve()

export function startRecommendationConsentBootstrap() {
  if (bootstrapPromise) return
  bootstrapPromise = new Promise<void>((resolve) => {
    resolveBootstrap = resolve
  })
}

export function completeRecommendationConsentBootstrap() {
  resolveBootstrap?.()
  resolveBootstrap = null
}

export async function waitForRecommendationConsentBootstrap() {
  // Compatibility for recommendation clients during retirement. Content-only
  // delivery has no profile bootstrap dependency.
  return
}

export async function withRecommendationConsentLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("forge-recommendation-consent", operation)
  }
  const result = fallbackLock.then(operation, operation)
  fallbackLock = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}
