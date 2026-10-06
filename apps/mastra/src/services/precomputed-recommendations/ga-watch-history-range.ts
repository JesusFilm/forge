/** Verified property metadata; a different property needs its own range contract. */
export const GA_WATCH_PROPERTY = {
  id: "320198532",
  createdDate: "2022-06-21",
  timeZone: "America/New_York",
} as const

const propertyDate = new Intl.DateTimeFormat("en-US", {
  timeZone: GA_WATCH_PROPERTY.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Last complete property-local calendar day strictly before the input cutoff. */
export function gaWatchClosedRangeEnd(inputCutoff: string): string {
  const parts = Object.fromEntries(
    propertyDate
      .formatToParts(new Date(inputCutoff))
      .map(({ type, value }) => [type, value]),
  )
  const localMidnight = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
  )
  return new Date(localMidnight - 86_400_000).toISOString().slice(0, 10)
}
