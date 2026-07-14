/**
 * Reject if `promise` outlives `ms` (or `signal` aborts), clearing the timer once
 * either settles — the one shared bounded-wait helper for RN async calls.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Resolution timed out")), ms)
    // Clear the timer the instant an abort fires, so a cancelled fan-out doesn't
    // leave one pending timer per in-flight call for the whole budget.
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("Aborted"))
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener("abort", onAbort, { once: true })
  })
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer)
    }),
    timeout,
  ])
}
