let bootstrapPromise: Promise<void> | null = null
let resolveBootstrap: (() => void) | null = null

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
  // Recommendations can render before the consent shell sibling. Establish
  // the barrier here as well so an early waiter cannot interpret a null
  // promise as an already-completed profile bootstrap.
  startRecommendationConsentBootstrap()
  await bootstrapPromise
}

export async function withRecommendationConsentLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("forge-recommendation-consent", operation)
  }
  return operation()
}
