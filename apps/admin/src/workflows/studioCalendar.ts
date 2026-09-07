import { sleep } from "workflow"

/** Durable timer. Each tick performs bounded canonical admissions, never production. */
export async function runStudioCalendarScheduler() {
  "use workflow"
  let cursor: string | undefined
  while (true) {
    try {
      cursor = (await stepStudioCalendarTick(cursor)).cursor
    } catch {
      cursor = undefined
    }
    await sleep("1m")
  }
}
export async function stepStudioCalendarTick(
  cursor?: string,
): Promise<
  import("@/services/studio-authoring/calendar-scheduler").CalendarTickResult
> {
  "use step"
  const { runStudioCalendarTick } =
    await import("@/services/studio-authoring/calendar-scheduler")
  return runStudioCalendarTick(cursor)
}
stepStudioCalendarTick.maxRetries = 0

/** Publication has its own timer so slow planning cannot delay due delivery. */
export async function runStudioCalendarPublicationScheduler() {
  "use workflow"
  let cursor: string | undefined
  while (true) {
    try {
      cursor = (await stepStudioCalendarPublicationTick(cursor)).cursor
    } catch {
      cursor = undefined
    }
    await sleep("15s")
  }
}
export async function stepStudioCalendarPublicationTick(
  cursor?: string,
): Promise<{ cursor?: string }> {
  "use step"
  const { prisma } = await import("@/db/client")
  const { StudioCalendarDispatcher } =
    await import("@/services/studio-authoring/calendar-dispatch")
  const result = await new StudioCalendarDispatcher(prisma).tick(cursor)
  // Reuse canonical durable visibility delivery, also recovering later unpublish.
  const { reconcileStudioWatch } =
    await import("@/services/studio-authoring/watch-delivery")
  await reconcileStudioWatch(prisma)
  return result
}
stepStudioCalendarPublicationTick.maxRetries = 0
