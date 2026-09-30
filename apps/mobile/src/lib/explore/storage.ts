/**
 * Helpers that the Explore stores share. Each store keeps its own key, version,
 * and prune rules; these only settle a storage call and read a stored object.
 */

/** Settles with the operation's value, or the fallback. Never rejects, even
 *  on a synchronous throw. */
export function settle<T>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return operation().then(
      (value) => value,
      () => fallback,
    )
  } catch {
    return Promise.resolve(fallback)
  }
}

/** Settles with the operation and never rejects, even on a synchronous throw.
 *  Resolves true when the operation succeeded. */
export function persistQuietly(
  operation: () => Promise<unknown>,
): Promise<boolean> {
  try {
    return operation().then(
      () => true,
      () => false,
    )
  } catch {
    return Promise.resolve(false)
  }
}

/** A stored JSON object, or null for no value, bad JSON, or another shape. */
export function parseObject(
  raw: string | null,
): Record<string, unknown> | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return null
  }
  return data as Record<string, unknown>
}
