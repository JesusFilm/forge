import { WorkerCleanupError } from "./errors.js"

export const WORKER_CLEANUP_GRACE_MS = 5000

/** A timeout reports unconfirmed cleanup; callers must retire, never reuse capacity. */
export async function settleWorkerCleanup(
  operation: Promise<void>,
): Promise<void> {
  const deadline = performance.now() + WORKER_CLEANUP_GRACE_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new WorkerCleanupError()),
          WORKER_CLEANUP_GRACE_MS,
        )
      }),
    ])
    if (performance.now() >= deadline) throw new WorkerCleanupError()
  } catch {
    throw new WorkerCleanupError()
  } finally {
    clearTimeout(timer)
  }
}
