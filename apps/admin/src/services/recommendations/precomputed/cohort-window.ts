/** Preserve the UTC clock time and clamp days missing from the target month. */
export function oneUtcCalendarMonthAfter(start: Date): Date {
  const end = new Date(start.getTime())
  const day = end.getUTCDate()
  end.setUTCDate(1)
  end.setUTCMonth(end.getUTCMonth() + 1)
  const lastDay = new Date(end.getTime())
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1)
  lastDay.setUTCDate(0)
  end.setUTCDate(Math.min(day, lastDay.getUTCDate()))
  return end
}
