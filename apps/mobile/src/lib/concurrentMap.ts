// Concurrency-capped, abortable fan-out with per-item settled results.
// Two consumers: the series resolution fan-out (U2) and the enqueue loop (U3).
// Mirrors prefetchHeroStream's in-flight cap and dubMediaFetch's sync-throw
// slot-leak discipline — one item failing (sync or async) never fails the batch,
// and an abort stops new work while in-flight items settle rejected.

export type SettledResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown }

const ABORT = Symbol("abort")

function abortError(): Error {
  return new Error("Aborted")
}

export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O> | O,
  signal?: AbortSignal,
): Promise<SettledResult<O>[]> {
  const n = items.length
  const results: SettledResult<O>[] = new Array(n)
  if (n === 0) return results

  const cap = Math.max(1, Math.min(Math.floor(limit) || 1, n))

  // Settles when the signal aborts; raced against each in-flight item so an
  // abort rejects work that is already running rather than waiting it out.
  // Held in an object so the executor's assignment survives TS control-flow
  // narrowing (a `let` reassigned inside the callback narrows back to null).
  const cleanup: { detach: (() => void) | null } = { detach: null }
  const abortPromise = new Promise<typeof ABORT>((resolve) => {
    if (!signal) return
    if (signal.aborted) {
      resolve(ABORT)
      return
    }
    const onAbort = () => resolve(ABORT)
    signal.addEventListener("abort", onAbort)
    cleanup.detach = () => signal.removeEventListener("abort", onAbort)
  })

  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) break
      const i = nextIndex
      nextIndex += 1
      if (i >= n) break

      // The async wrapper turns a synchronous throw into a rejected promise,
      // so a sync-throwing fn settles as rejected and the slot frees normally.
      const runOne = (async () => fn(items[i], i))().then(
        (value): SettledResult<O> => ({ status: "fulfilled", value }),
        (reason): SettledResult<O> => ({ status: "rejected", reason }),
      )
      const settled = await Promise.race([runOne, abortPromise])
      if (settled === ABORT) {
        results[i] = { status: "rejected", reason: abortError() }
        break
      }
      results[i] = settled
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()))
  cleanup.detach?.()

  // Fill slots that were never started (or aborted before running).
  for (let i = 0; i < n; i += 1) {
    if (results[i] === undefined) {
      results[i] = { status: "rejected", reason: abortError() }
    }
  }
  return results
}
