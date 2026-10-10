// Pure clock formatter for HomeTopBar — extracted so it's unit-testable
// (jest-expo can't load .tsx, but this plain .ts module can be imported
// directly by clockFormat.test.ts).

/**
 * h:mm, 12-hour, no AM/PM. Manual formatting (not toLocaleTimeString) so Hermes'
 * Intl coverage is never a factor. `% 12 || 12` maps both 0 and 12 to 12.
 */
export function formatClock(date: Date): string {
  const hours = date.getHours() % 12 || 12
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}
