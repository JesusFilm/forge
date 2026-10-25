/** Wait for a retry delay unless the caller's request budget expires first. */
export async function sleepUnlessAborted(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false

  let onAbort: (() => void) | undefined
  try {
    await Promise.race([
      sleep(ms),
      new Promise<void>((resolve) => {
        onAbort = () => resolve()
        signal.addEventListener("abort", onAbort, { once: true })
      }),
    ])
    return !signal.aborted
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort)
  }
}
