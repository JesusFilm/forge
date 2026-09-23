export class RedisAvailabilityError extends Error {}

/** Limit waiting and unresolved wire work independently: a timeout is not cancellation. */
export function createRedisOperationGuard(
  timeoutMs: number,
  maxPending: number,
) {
  let pending = 0
  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (pending >= maxPending) {
      throw new RedisAvailabilityError("Redis operation capacity exceeded")
    }
    pending += 1
    const deadline = performance.now() + timeoutMs
    return new Promise<T>((resolve, reject) => {
      const timeout = () =>
        reject(new RedisAvailabilityError("Redis operation timed out"))
      const timer = setTimeout(timeout, timeoutMs)
      void Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            pending -= 1
            clearTimeout(timer)
            if (performance.now() >= deadline) timeout()
            else resolve(value)
          },
          (error: unknown) => {
            pending -= 1
            clearTimeout(timer)
            reject(error)
          },
        )
    })
  }
}
