/** Wait for actual navigation without making recommendations a rendering dependency. */
export function waitForRecommendationActivation(
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const prerendering = () =>
      (document as Document & { prerendering?: boolean }).prerendering === true
    const cleanup = () => {
      document.removeEventListener("prerenderingchange", activate)
      signal?.removeEventListener("abort", abort)
    }
    const abort = () => {
      cleanup()
      reject(
        new DOMException("Recommendation activation cancelled", "AbortError"),
      )
    }
    const activate = () => {
      if (prerendering()) return
      cleanup()
      resolve()
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener("abort", abort, { once: true })
    if (prerendering())
      document.addEventListener("prerenderingchange", activate)
    else queueMicrotask(activate)
  })
}

export function isDeferredRecommendationResponse(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { deliveryDisposition?: unknown }).deliveryDisposition ===
      "deferred"
  )
}
