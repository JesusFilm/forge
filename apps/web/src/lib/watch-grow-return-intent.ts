/** Small entry predicate: the full curriculum and saved progress remain deferred. */
export function hasWatchGrowReturnIntent(href?: string): boolean {
  const address =
    href ?? (typeof window === "undefined" ? undefined : window.location.href)
  if (!address) return false
  try {
    const lesson = new URL(address).searchParams.get("growLesson")
    return /^lesson-[1-9]$/.test(lesson ?? "")
  } catch {
    return false
  }
}
