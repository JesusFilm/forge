/**
 * Run an ordered list with a fixed worker pool. This preserves input order in
 * returned values while bounding concurrent work.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await map(items[index]!)
      }
    }),
  )

  return results
}
