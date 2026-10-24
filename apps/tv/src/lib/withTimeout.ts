// Ported verbatim from apps/mobile/src/lib/withTimeout.ts. Bounds the Experience
// (watchSetting) fetch so a slow admin never stalls the whole Home render — the
// config-pool videos fetch (which feeds the fallback rows) is NOT wrapped.

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Resolution timed out")), ms)
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
