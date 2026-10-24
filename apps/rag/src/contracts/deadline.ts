export class DeadlineError extends Error {
  override readonly name = "DeadlineError"
  constructor() {
    super("downstream_deadline_exceeded")
  }
}

/** Bound the caller and cancel downstream work that accepts the signal. */
export async function withDeadline<T>(
  milliseconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new DeadlineError()
          controller.abort(error)
          reject(error)
        }, milliseconds)
      }),
      operation(controller.signal),
    ])
  } finally {
    clearTimeout(timer)
  }
}
