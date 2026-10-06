// The pass runner that the reminder and widget writers share. Each writer
// rebuilds its whole output from the latest inputs, so only the last pass of a
// burst matters.

/** One pass at a time. A pass that has not started yet takes every later
 *  request, because it reads its inputs when it starts. A failed pass ends
 *  quietly, and the next pass runs as usual. */
export function createPassRunner(
  runOnce: () => Promise<void>,
): () => Promise<void> {
  let chain: Promise<unknown> = Promise.resolve()
  let waiting: Promise<void> | null = null
  return function runPass() {
    if (waiting) return waiting
    const step = () => {
      waiting = null
      return runOnce()
    }
    const next = chain.then(step, step).catch(() => undefined)
    waiting = next
    chain = next
    return next
  }
}

export type PassTriggers = {
  runPass: () => Promise<void>
  subscribeToAppState: (listener: (state: string) => void) => () => void
  /** A store whose change asks for a pass. */
  subscribeToStore: (listener: () => void) => () => void
}

/** A pass now, on each return to the foreground, and on each store change. */
export function attachPassTriggers({
  runPass,
  subscribeToAppState,
  subscribeToStore,
}: PassTriggers): () => void {
  const unsubscribeAppState = subscribeToAppState((state) => {
    if (state === "active") void runPass()
  })
  const unsubscribeStore = subscribeToStore(() => {
    void runPass()
  })
  void runPass()
  return () => {
    unsubscribeAppState()
    unsubscribeStore()
  }
}
