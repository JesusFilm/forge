/** Reject if `promise` outlives `ms`, clearing the timer once either settles. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline-exceeded")), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}
