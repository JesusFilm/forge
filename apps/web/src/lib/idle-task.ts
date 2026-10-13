type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

/**
 * Runs `task` once the browser is idle, and never later than `timeoutMs`.
 *
 * Uses `requestIdleCallback` with the same bound as its `timeout`. Browsers
 * without it (Safari) wait for the window `load` event and then yield one
 * task, still capped at `timeoutMs`. Returns a cleanup that cancels every
 * pending path; the task runs at most once.
 */
export function scheduleIdleTask(
  task: () => void,
  { timeoutMs }: { timeoutMs: number },
): () => void {
  if (typeof window === "undefined") return () => {}

  const idleWindow = window as IdleWindow
  const cleanups: Array<() => void> = []
  let settled = false
  const cancel = () => {
    settled = true
    for (const cleanup of cleanups.splice(0)) cleanup()
  }
  const run = () => {
    if (settled) return
    cancel()
    task()
  }

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(run, { timeout: timeoutMs })
    cleanups.push(() => idleWindow.cancelIdleCallback?.(handle))
    return cancel
  }

  const cap = window.setTimeout(run, timeoutMs)
  cleanups.push(() => window.clearTimeout(cap))

  const yieldThenRun = () => {
    const handle = window.setTimeout(run, 0)
    cleanups.push(() => window.clearTimeout(handle))
  }
  if (document.readyState === "complete") {
    yieldThenRun()
  } else {
    window.addEventListener("load", yieldThenRun, { once: true })
    cleanups.push(() => window.removeEventListener("load", yieldThenRun))
  }
  return cancel
}
