import { studioInstructionCommandSchema } from "./agent"
import { z } from "zod"
import { studioIdSchema, studioInstructionReferenceSchema } from "./index"
import { contentPackDocumentSchema } from "./content-packs"

export const calendarZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((zone) => {
    // Intl also accepts numeric offset identifiers; the calendar requires named
    // IANA rules (including supported aliases), not a fixed offset supplied as a zone.
    if (/^[+-]/.test(zone)) return false
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone })
      return true
    } catch {
      return false
    }
  }, "Explicit valid IANA timezone required")
export const calendarDateSchema = z.iso.date()
export const calendarTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export class CalendarTimeError extends Error {}

function parts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`
}
export function calendarDays(zone: string, now = new Date()): string[] {
  calendarZoneSchema.parse(zone)
  const first = parts(now, zone).slice(0, 10)
  return Array.from({ length: 28 }, (_, i) =>
    new Date(Date.parse(first + "T12:00:00Z") + i * 86400000)
      .toISOString()
      .slice(0, 10),
  )
}

/** Civil dates are not UTC instants. Enumerate observed offsets, then round-trip
 * each candidate; gaps and folds must never silently choose a different time. */
export function resolveCalendarTime(
  date: string,
  time: string,
  zone: string,
  occurrence?: "earlier" | "later",
) {
  calendarDateSchema.parse(date)
  calendarTimeSchema.parse(time)
  calendarZoneSchema.parse(zone)
  const local = `${date}T${time}`,
    naive = Date.parse(local + ":00Z")
  const offsets = new Set<number>()
  for (let h = -36; h <= 36; h += 6) {
    const instant = naive + h * 3600000
    offsets.add(Date.parse(parts(new Date(instant), zone) + ":00Z") - instant)
  }
  const candidates = [...offsets]
    .map((offset) => naive - offset)
    .filter((value) => parts(new Date(value), zone) === local)
    .sort((a, b) => a - b)
  if (!candidates.length) throw new CalendarTimeError("NONEXISTENT_TIME")
  if (candidates.length > 1 && !occurrence)
    throw new CalendarTimeError("AMBIGUOUS_TIME")
  return new Date(
    occurrence === "later" ? candidates[candidates.length - 1] : candidates[0],
  ).toISOString()
}

const version = z.number().int().min(0).max(2147483646)
export const calendarSettingsSchema = z
  .object({
    timeZone: calendarZoneSchema,
    publishTime: calendarTimeSchema,
    deliveryWindowMinutes: z.number().int().min(1).max(1440),
    plannerTimes: z
      .array(calendarTimeSchema)
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    automationEnabled: z.boolean(),
    defaultPackRevisionIds: z
      .array(studioIdSchema)
      .max(16)
      .refine((v) => new Set(v).size === v.length),
    language: z.string().min(1).max(100),
  })
  .strict()
export const calendarCommandSchema = z
  .object({
    calendarId: studioIdSchema,
    expectedVersion: version,
    idempotencyKey: studioIdSchema,
  })
  .strict()
export const configureCalendarSchema = calendarCommandSchema.extend({
  settings: calendarSettingsSchema,
})
export const editCalendarSlotSchema = calendarCommandSchema.extend({
  date: calendarDateSchema,
  title: z.string().max(300),
  theme: z.string().max(2000),
  packRevisionId: studioIdSchema.nullable(),
  projectId: studioIdSchema.nullable(),
})
export const assignCalendarWeekSchema = calendarCommandSchema.extend({
  startDate: calendarDateSchema,
  packRevisionId: studioIdSchema.nullable(),
  theme: z.string().max(2000),
})
export const calendarPlanItemSchema = z
  .object({
    date: calendarDateSchema,
    expectedVersion: version,
    title: z.string().min(1).max(300),
    theme: z.string().min(1).max(2000),
    packRevisionId: studioIdSchema,
    // Index into the immutable Content Pack, not an invented catalog identity.
    sourceIndices: z.array(z.number().int().min(0).max(63)).max(16),
  })
  .strict()
export const calendarPlanResultSchema = z
  .object({
    weeks: z
      .array(
        z
          .object({
            startDate: calendarDateSchema,
            theme: z.string().min(1).max(2000),
            packRevisionId: studioIdSchema,
            sourceIndices: z.array(z.number().int().min(0).max(63)).max(16),
          })
          .strict(),
      )
      .max(4)
      .refine(
        (weeks) =>
          new Set(weeks.map((week) => week.startDate)).size === weeks.length,
      )
      .optional(),
    items: z
      .array(calendarPlanItemSchema)
      .max(28)
      .refine((v) => new Set(v.map((i) => i.date)).size === v.length),
    instructions: z.array(studioInstructionReferenceSchema).min(1).max(64),
    effectiveDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine(
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 98304,
    "Plan exceeds 96 KiB",
  )
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>
export type CalendarPlanResult = z.infer<typeof calendarPlanResultSchema>
export const calendarPlannerInputSchema = z
  .object({
    calendarId: studioIdSchema,
    version,
    language: z.string().min(1).max(100),
    weeks: z
      .array(
        z
          .object({
            startDate: calendarDateSchema,
            packRevisionIds: z.array(studioIdSchema).max(43),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    slots: z
      .array(
        z
          .object({
            date: calendarDateSchema,
            version,
            packRevisionIds: z.array(studioIdSchema).max(16),
            weeklyTheme: z.string().max(2000),
          })
          .strict(),
      )
      .max(28),
    packs: z
      .array(
        z
          .object({
            revisionId: studioIdSchema,
            document: contentPackDocumentSchema,
          })
          .strict(),
      )
      // One slot may use 16 defaults while the other 27 use distinct assignments.
      .max(43),
  })
  .strict()
  .refine(
    (v) => new TextEncoder().encode(JSON.stringify(v)).length <= 196608,
    "Planning context exceeds 192 KiB",
  )
export type CalendarPlannerInput = z.infer<typeof calendarPlannerInputSchema>

export const calendarAuthorizationSchema = calendarCommandSchema.extend({
  expectedCalendarVersion: version,
  date: calendarDateSchema,
  projectId: studioIdSchema,
  expectedRevision: z.number().int().positive(),
  approvalId: studioIdSchema,
  renderAttemptId: studioIdSchema,
  releaseId: studioIdSchema,
  occurrence: z.enum(["earlier", "later"]).optional(),
})

export const calendarSuggestionsSchema = z
  .object({
    items: calendarPlanResultSchema.shape.items,
    weeks: calendarPlanResultSchema.shape.weeks,
  })
  .strict()
export class CalendarPlanError extends Error {}
export function parseCalendarSuggestions(
  raw: unknown,
  context: CalendarPlannerInput,
) {
  const result = calendarSuggestionsSchema.parse(raw)
  for (const week of result.weeks ?? []) {
    const admitted = context.weeks?.find(
      (entry) => entry.startDate === week.startDate,
    )
    const pack = context.packs.find(
      (entry) => entry.revisionId === week.packRevisionId,
    )
    if (
      !admitted ||
      !admitted.packRevisionIds.includes(week.packRevisionId) ||
      !pack ||
      week.sourceIndices.some((index) => !pack.document.sources[index])
    )
      throw new CalendarPlanError("INVALID_PLANNING_BINDING")
  }
  for (const item of result.items) {
    const slot = context.slots.find((slot) => slot.date === item.date)
    const pack = context.packs.find(
      (pack) => pack.revisionId === item.packRevisionId,
    )
    if (
      !slot ||
      slot.version !== item.expectedVersion ||
      !slot.packRevisionIds.includes(item.packRevisionId) ||
      !pack ||
      item.sourceIndices.some((index) => !pack.document.sources[index])
    )
      throw new CalendarPlanError("INVALID_PLANNING_BINDING")
  }
  return result
}

export const calendarNativeInputSchema = z
  .object({ runId: studioIdSchema, input: calendarPlannerInputSchema })
  .strict()
export const calendarRuntimeRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("instructions"),
      command: studioInstructionCommandSchema,
    })
    .strict(),
  calendarNativeInputSchema.extend({ action: z.literal("freeze") }),
  calendarNativeInputSchema.extend({
    action: z.literal("run"),
    admission: z.string().min(1).max(4096),
  }),
])

export const calendarViewSchema = z.object({
  planningRun: z
    .object({
      id: studioIdSchema,
      status: z.string(),
      createdAt: z.iso.datetime(),
      finishedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  calendarId: studioIdSchema,
  version,
  settings: calendarSettingsSchema,
  weeks: z
    .array(
      z.object({
        provenance: z
          .object({
            runId: studioIdSchema,
            packRevisionId: studioIdSchema.optional(),
            instructions: z.array(studioInstructionReferenceSchema),
            effectiveDigest: z.string(),
            sourceIndices: z.array(z.number().int()),
            sourceState: z.enum(["SELECTED", "MISSING"]),
          })
          .nullable()
          .optional(),
        startDate: calendarDateSchema,
        packRevisionId: studioIdSchema.nullable(),
        theme: z.string(),
      }),
    )
    .max(8),
  slots: z
    .array(
      z.object({
        id: studioIdSchema,
        date: calendarDateSchema,
        version,
        title: z.string(),
        theme: z.string(),
        manual: z.boolean(),
        packRevisionId: studioIdSchema.nullable(),
        projectId: studioIdSchema.nullable(),
        project: z
          .object({
            currentRevision: version,
            lifecycle: z.string(),
            currentRevisionRecord: z.object({
              attempts: z
                .array(z.object({ id: studioIdSchema, status: z.string() }))
                .max(1),
              approvals: z.array(z.object({ id: studioIdSchema })).max(1),
            }),
          })
          .nullable(),
        projectSourcesSelected: z.boolean(),
        provenance: z
          .object({ sourceState: z.enum(["SELECTED", "MISSING"]) })
          .passthrough()
          .nullable(),
        authorizations: z
          .array(
            z.object({
              id: studioIdSchema,
              version,
              dueAt: z.iso.datetime(),
              latestAllowedAt: z.iso.datetime(),
              revokedAt: z.iso.datetime().nullable(),
              consumedAt: z.iso.datetime().nullable(),
              outcome: z.string().nullable(),
              hasSubmission: z.boolean().optional(),
              dispatch: z
                .object({
                  state: z.enum([
                    "PENDING",
                    "RUNNING",
                    "RETRY",
                    "ACCEPTED",
                    "BLOCKED",
                  ]),
                  attempts: z.number().int(),
                  lastError: z.string().nullable(),
                  nextAttemptAt: z.iso.datetime(),
                })
                .nullable()
                .optional(),
            }),
          )
          .max(1),
      }),
    )
    .length(28),
})
export type CalendarView = z.infer<typeof calendarViewSchema>

export const calendarProductionSchema = z
  .object({
    calendarId: studioIdSchema,
    idempotencyKey: studioIdSchema,
    confirmed: z.literal(true),
    targets: z
      .array(
        z
          .object({
            date: calendarDateSchema,
            version,
            projectId: studioIdSchema,
            revision: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .refine(
        (targets) =>
          new Set(targets.map((target) => target.projectId)).size ===
          targets.length,
      ),
  })
  .strict()
