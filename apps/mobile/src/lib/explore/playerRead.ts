// A released VideoPlayer throws on property access, and a feed player can be
// read or written after the unmount released it. Every such access goes here.

export function safely(action: () => void): void {
  try {
    action()
  } catch {
    // The player was already released.
  }
}

export function readOr<T>(get: () => T, fallback: T): T {
  try {
    return get()
  } catch {
    return fallback
  }
}

/** A finite time in seconds, or null when the read throws or is not finite. */
export function readSeconds(get: () => number): number | null {
  const seconds = readOr(get, Number.NaN)
  return Number.isFinite(seconds) ? seconds : null
}
