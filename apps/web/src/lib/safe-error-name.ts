/** Return one bounded log token without reading an error message or body. */
export function safeErrorName(error: unknown): string {
  const fallback = typeof error
  try {
    // `name` is writable and may have a throwing getter. Read it once, inside
    // this guard, so diagnostics cannot undo the caller's fail-soft result.
    const name: unknown = error instanceof Error ? error.name : fallback
    const value = typeof name === "string" ? name : fallback
    return value.replace(/[^\w.:-]/g, "_").slice(0, 64) || fallback
  } catch {
    return fallback
  }
}
