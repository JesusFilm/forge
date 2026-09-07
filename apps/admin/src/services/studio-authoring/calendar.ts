import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import {
  calendarDays,
  calendarSettingsSchema,
  configureCalendarSchema,
  editCalendarSlotSchema,
  calendarPlanResultSchema,
  calendarPlannerInputSchema,
  assignCalendarWeekSchema,
  resolveCalendarTime,
  CalendarTimeError,
  parseCalendarSuggestions,
} from "@forge/studio-contracts/calendar"
import { contentPackDocumentSchema } from "@forge/studio-contracts/content-packs"
import { studioIdSchema } from "@forge/studio-contracts"
import type { Principal } from "@/auth/principal"
import { canReviewStudio } from "@/auth/permissions"
import { ForbiddenError, NotFoundError } from "../errors"
import { lockProject, studioActor, studioHash } from "./state"
import { StudioCommandError } from "./errors"

// Reference presence only. Canonical publication independently revalidates eligibility.
export const calendarSelectedSourceSql = Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(revision.document->'items') item
                    WHERE item->>'kind' = 'video')
            OR EXISTS (
              SELECT 1 FROM content_pack_revision pack
              WHERE pack.id IN (SELECT jsonb_array_elements_text(revision.document->'packRevisionIds'))
                AND jsonb_array_length(pack.document->'sources') > 0
            )`

type Tx = Prisma.TransactionClient
export async function calendarOperator(tx: Tx, user: Principal | null) {
  if (!canReviewStudio(user) || !user?.id)
    throw new ForbiddenError("Interactive calendar operator required")
  const rows = await tx.$queryRaw<
    { user_id: string }[]
  >`SELECT user_id FROM manager_membership WHERE user_id=${user.id} AND role='OPERATOR' AND revoked_at IS NULL FOR SHARE`
  if (!rows.length)
    throw new ForbiddenError("Current calendar operator required")
  return user.id
}
export const slotId = (calendarId: string, date: string) =>
  studioHash({ calendarId, date })
export async function calendarSettings(tx: Tx, id: string) {
  const row = await tx.studioCalendar.findUnique({ where: { id } })
  if (!row) throw new NotFoundError("StudioCalendar")
  return { ...row, settings: calendarSettingsSchema.parse(row.settings) }
}
export async function lockCalendarSlot(
  tx: Tx,
  calendarId: string,
  date: string,
) {
  const id = slotId(calendarId, date)
  await tx.studioPlanSlot.upsert({
    where: { id },
    create: { id, calendarId, date },
    update: {},
  })
  await tx.$queryRaw`SELECT id FROM studio_plan_slot WHERE id=${id} FOR UPDATE`
  return tx.studioPlanSlot.findUniqueOrThrow({ where: { id } })
}
export async function calendarCommand<T>(
  db: PrismaClient,
  user: Principal | null,
  command: string,
  input: { calendarId: string; idempotencyKey: string },
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const hash = studioHash({ command, input, actor: studioActor(user) })
  return db.$transaction(async (tx) => {
    await calendarOperator(tx, user)
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.calendarId + ":" + input.idempotencyKey},461))::text`
    const prior = await tx.studioCalendarCommand.findUnique({
      where: {
        calendarId_key: {
          calendarId: input.calendarId,
          key: input.idempotencyKey,
        },
      },
    })
    if (prior) {
      if (prior.inputHash !== hash) throw new StudioCommandError("CONFLICT")
      return prior.result as T
    }
    const result = await work(tx)
    await tx.studioCalendarCommand.create({
      data: {
        calendarId: input.calendarId,
        key: input.idempotencyKey,
        inputHash: hash,
        result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
      },
    })
    return result
  })
}
export class StudioCalendarService {
  constructor(private readonly db: PrismaClient) {}
  async configure(user: Principal | null, raw: unknown) {
    const input = configureCalendarSchema.parse(raw)
    return calendarCommand(this.db, user, "configure", input, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.calendarId},462))::text`
      // Creation needs the advisory lock; existing calendars share the row lock
      // used by weekly edits, planning admission and completion.
      await tx.$queryRaw`SELECT id FROM studio_calendar WHERE id=${input.calendarId} FOR UPDATE`
      const old = await tx.studioCalendar.findUnique({
        where: { id: input.calendarId },
      })
      if ((old?.version ?? 0) !== input.expectedVersion)
        throw new StudioCommandError("CONFLICT")
      for (const id of input.settings.defaultPackRevisionIds)
        if (!(await tx.contentPackRevision.findUnique({ where: { id } })))
          throw new NotFoundError("ContentPackRevision")
      const version = input.expectedVersion + 1
      await tx.studioCalendar.upsert({
        where: { id: input.calendarId },
        create: { id: input.calendarId, version, settings: input.settings },
        update: { version, settings: input.settings },
      })
      return { calendarId: input.calendarId, version }
    })
  }
  async read(user: Principal | null, rawId: unknown) {
    studioActor(user)
    const calendarId = studioIdSchema.parse(rawId)
    const config = await calendarSettings(this.db, calendarId),
      days = calendarDays(config.settings.timeZone)
    const rows = await this.db.studioPlanSlot.findMany({
      where: { calendarId, date: { in: days } },
      include: {
        project: {
          select: {
            currentRevision: true,
            lifecycle: true,
            currentRevisionRecord: {
              select: {
                attempts: {
                  where: { kind: "GENERATION" },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { id: true, status: true },
                },
                approvals: {
                  where: { kind: "PUBLICATION" },
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        },
        authorizations: {
          orderBy: { version: "desc" },
          take: 1,
          include: { dispatch: true },
        },
      },
    })
    // Project selection is independent of planner provenance. Inspect only
    // reference presence at these exact revisions, not eligibility or bytes.
    const linked = rows.flatMap((row) =>
      row.project && row.projectId
        ? [
            Prisma.sql`(${row.id}::text, ${row.projectId}::text, ${row.project.currentRevision}::integer)`,
          ]
        : [],
    )
    const selected = linked.length
      ? await this.db.$queryRaw<
          Array<{ id: string; selected: boolean }>
        >(Prisma.sql`
          SELECT requested.id, (
            ${calendarSelectedSourceSql}
          ) AS selected
          FROM (VALUES ${Prisma.join(linked)}) AS requested(id, project_id, revision_number)
          JOIN studio_project_revision revision
            ON revision.project_id = requested.project_id AND revision.number = requested.revision_number
        `)
      : []
    const sourceSelections = new Map(
      selected.map((row) => [row.id, row.selected]),
    )
    const byDate = new Map(
      rows.map((row) => [
        row.date,
        {
          ...row,
          authorizations: row.authorizations.map(
            ({ submission, ...authorization }) => ({
              ...authorization,
              hasSubmission: submission !== null,
            }),
          ),
          projectSourcesSelected: sourceSelections.get(row.id) ?? false,
        },
      ]),
    )
    const weeks = await this.db.studioPlanWeek.findMany({
      where: {
        calendarId,
        startDate: {
          gte: new Date(Date.parse(days[0] + "T12:00Z") - 6 * 86400000)
            .toISOString()
            .slice(0, 10),
          lte: days[27],
        },
      },
      orderBy: { startDate: "asc" },
      take: 8,
    })
    const planningRun = await this.db.studioPlanningRun.findFirst({
      where: { calendarId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true, finishedAt: true },
    })
    return {
      planningRun,
      calendarId,
      version: config.version,
      settings: config.settings,
      weeks,
      slots: days.map((date) => {
        const row = byDate.get(date)
        return (
          row ?? {
            id: slotId(calendarId, date),
            calendarId,
            date,
            version: 0,
            title: "",
            theme: "",
            manual: false,
            packRevisionId: null,
            projectId: null,
            provenance: null,
            project: null,
            projectSourcesSelected: false,
            authorizations: [],
          }
        )
      }),
    }
  }
  async editSlot(user: Principal | null, raw: unknown) {
    const input = editCalendarSlotSchema.parse(raw)
    return calendarCommand(this.db, user, "edit-slot", input, async (tx) => {
      const config = await calendarSettings(tx, input.calendarId)
      if (!calendarDays(config.settings.timeZone).includes(input.date))
        throw new StudioCommandError("INVALID")
      const id = slotId(input.calendarId, input.date),
        before = await tx.studioPlanSlot.findUnique({ where: { id } })
      const projects = [
        ...new Set(
          [before?.projectId, input.projectId].filter(
            (id): id is string => !!id,
          ),
        ),
      ].sort()
      for (const projectId of projects) await lockProject(tx, projectId)
      const slot = await lockCalendarSlot(tx, input.calendarId, input.date)
      if (
        slot.version !== input.expectedVersion ||
        slot.projectId !== (before?.projectId ?? null)
      )
        throw new StudioCommandError("CONFLICT")
      if (
        input.packRevisionId &&
        !(await tx.contentPackRevision.findUnique({
          where: { id: input.packRevisionId },
        }))
      )
        throw new NotFoundError("ContentPackRevision")
      await tx.studioScheduleAuthorization.updateMany({
        where: { slotId: id, revokedAt: null, consumedAt: null },
        data: { revokedAt: new Date() },
      })
      const result = await tx.studioPlanSlot.update({
        where: { id },
        data: {
          title: input.title,
          theme: input.theme,
          ...(slot.packRevisionId !== input.packRevisionId
            ? { provenance: Prisma.DbNull }
            : {}),
          packRevisionId: input.packRevisionId,
          projectId: input.projectId,
          manual:
            slot.manual ||
            input.title !== slot.title ||
            input.theme !== slot.theme,
          version: { increment: 1 },
        },
      })
      return { slotId: id, version: result.version }
    })
  }
  async assignWeek(user: Principal | null, raw: unknown) {
    const input = assignCalendarWeekSchema.parse(raw)
    if (new Date(input.startDate + "T12:00:00Z").getUTCDay() !== 1)
      throw new StudioCommandError("INVALID")
    return calendarCommand(this.db, user, "assign-week", input, async (tx) => {
      await tx.$queryRaw`SELECT id FROM studio_calendar WHERE id=${input.calendarId} FOR UPDATE`
      const fresh = await calendarSettings(tx, input.calendarId)
      if (fresh.version !== input.expectedVersion)
        throw new StudioCommandError("CONFLICT")
      const days = calendarDays(fresh.settings.timeZone)
      if (
        input.startDate > days[27] ||
        Date.parse(input.startDate + "T00:00Z") <
          Date.parse(days[0] + "T00:00Z") - 6 * 86400000
      )
        throw new StudioCommandError("INVALID")
      if (
        input.packRevisionId &&
        !(await tx.contentPackRevision.findUnique({
          where: { id: input.packRevisionId },
        }))
      )
        throw new NotFoundError("ContentPackRevision")
      await tx.studioPlanWeek.upsert({
        where: {
          calendarId_startDate: {
            calendarId: input.calendarId,
            startDate: input.startDate,
          },
        },
        create: {
          calendarId: input.calendarId,
          startDate: input.startDate,
          theme: input.theme,
          packRevisionId: input.packRevisionId,
        },
        update: {
          theme: input.theme,
          packRevisionId: input.packRevisionId,
          provenance: Prisma.DbNull,
        },
      })
      await tx.studioCalendar.update({
        where: { id: input.calendarId },
        data: { version: { increment: 1 } },
      })
      return { calendarId: input.calendarId, version: fresh.version + 1 }
    })
  }
  async beginPlanning(user: Principal | null, raw: unknown) {
    const input = z
      .object({ calendarId: studioIdSchema, idempotencyKey: studioIdSchema })
      .strict()
      .parse(raw)
    return this.db.$transaction(async (tx) => {
      await calendarOperator(tx, user)
      await tx.$queryRaw`SELECT id FROM studio_calendar WHERE id=${input.calendarId} FOR UPDATE`
      return this.admitPlan(
        tx,
        input.calendarId,
        "manual:" + input.idempotencyKey,
        "manual",
        studioActor(user),
      )
    })
  }
  /** Trusted workflow admission, bounded to one occurrence per configured local
   * wall time. Skip missed days and DST gaps; a fold is one named occurrence. */
  async beginAutomaticPlanning(user: Principal | null, rawId: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted planner admission required")
    const calendarId = studioIdSchema.parse(rawId)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM studio_calendar WHERE id=${calendarId} FOR UPDATE`
      const config = await calendarSettings(tx, calendarId),
        now = new Date()
      if (!config.settings.automationEnabled) return null
      const today = calendarDays(config.settings.timeZone, now)[0]
      const due = config.settings.plannerTimes
        .map((time) => {
          try {
            return {
              time,
              instant: Date.parse(
                resolveCalendarTime(
                  today,
                  time,
                  config.settings.timeZone,
                  "earlier",
                ),
              ),
            }
          } catch (error) {
            if (error instanceof CalendarTimeError) return null
            throw error
          }
        })
        .filter(
          (value): value is { time: string; instant: number } =>
            value !== null && value.instant <= now.getTime(),
        )
        .sort((a, b) => b.instant - a.instant)[0]
      if (!due) return null
      const occurrence = "automatic:" + today + ":" + due.time
      const prior = await tx.studioPlanningRun.findUnique({
        where: { calendarId_occurrence: { calendarId, occurrence } },
      })
      if (
        !prior &&
        (await tx.studioPlanningRun.count({
          where: {
            calendarId,
            occurrence: { startsWith: "automatic:" + today + ":" },
          },
        })) >= config.settings.plannerTimes.length
      )
        return null
      return this.admitPlan(
        tx,
        calendarId,
        occurrence,
        "automatic",
        studioActor(user),
      )
    })
  }
  private async admitPlan(
    tx: Tx,
    calendarId: string,
    occurrence: string,
    mode: "manual" | "automatic",
    actor: ReturnType<typeof studioActor>,
  ) {
    const prior = await tx.studioPlanningRun.findUnique({
      where: { calendarId_occurrence: { calendarId, occurrence } },
    })
    if (prior)
      return { ...prior, input: calendarPlannerInputSchema.parse(prior.input) }
    const config = await calendarSettings(tx, calendarId),
      days = calendarDays(config.settings.timeZone)
    const slots: z.infer<typeof calendarPlannerInputSchema>["slots"] = []
    const weeks = await tx.studioPlanWeek.findMany({
      where: { calendarId },
      orderBy: { startDate: "desc" },
      take: 100,
    })
    const packIds = new Set<string>(),
      requestedDays = mode === "automatic" ? days.slice(14) : days,
      protectedWeeks = new Set<string>()
    const weekStart = (date: string) => {
      const instant = new Date(date + "T12:00Z")
      instant.setUTCDate(instant.getUTCDate() - ((instant.getUTCDay() + 6) % 7))
      return instant.toISOString().slice(0, 10)
    }
    for (const date of requestedDays) {
      const slot = await lockCalendarSlot(tx, calendarId, date)
      if (slot.manual || slot.title || slot.theme || slot.projectId) {
        protectedWeeks.add(weekStart(date))
        continue
      }
      const week = weeks.find(
        (w) =>
          w.startDate <= date &&
          Date.parse(date + "T00:00Z") - Date.parse(w.startDate + "T00:00Z") <
            7 * 86400000,
      )
      const assigned = slot.packRevisionId ?? week?.packRevisionId
      const ids = assigned ? [assigned] : config.settings.defaultPackRevisionIds
      ids.forEach((id) => packIds.add(id))
      slots.push({
        date,
        version: slot.version,
        packRevisionIds: ids,
        weeklyTheme: week?.theme ?? "",
      })
    }
    // Partial weeks are not admitted: a weekly theme must not reach into the
    // current fortnight or another date outside this planning request.
    const planningWeeks = requestedDays
      .filter(
        (date) =>
          weekStart(date) === date &&
          Date.parse(date + "T00:00Z") + 6 * 86400000 <=
            Date.parse(requestedDays.at(-1)! + "T00:00Z") &&
          !protectedWeeks.has(date) &&
          !weeks.some((week) => week.startDate === date),
      )
      .map((startDate) => ({
        startDate,
        packRevisionIds: [
          ...new Set(
            slots
              .filter(
                (slot) =>
                  slot.date >= startDate &&
                  Date.parse(slot.date + "T00:00Z") <
                    Date.parse(startDate + "T00:00Z") + 7 * 86400000,
              )
              .flatMap((slot) => slot.packRevisionIds),
          ),
        ],
      }))
    const packs = []
    for (const revisionId of packIds) {
      const pack = await tx.contentPackRevision.findUnique({
        where: { id: revisionId },
      })
      if (pack)
        packs.push({
          revisionId,
          document: contentPackDocumentSchema.parse(pack.document),
        })
    }
    const context = calendarPlannerInputSchema.parse({
      calendarId,
      version: config.version,
      language: config.settings.language,
      slots,
      weeks: planningWeeks,
      packs,
    })
    const run = await tx.studioPlanningRun.create({
      data: {
        id: randomUUID(),
        calendarId,
        occurrence,
        version: config.version,
        input: context,
        actor,
      },
    })
    return { ...run, input: context }
  }
  async claimPlanning(user: Principal | null, rawId: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted planner dispatch required")
    const id = studioIdSchema.parse(rawId)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM studio_planning_run WHERE id=${id} FOR UPDATE`
      const run = await tx.studioPlanningRun.findUniqueOrThrow({
        where: { id },
      })
      if (run.status !== "RUNNING") return null
      if (Date.now() - run.createdAt.getTime() > 300000) {
        await tx.studioPlanningRun.update({
          where: { id },
          data: {
            status: "INTERRUPTED",
            result: { reason: "INTERRUPTED" },
            finishedAt: new Date(),
          },
        })
        return null
      }
      await tx.studioPlanningRun.update({
        where: { id },
        data: { status: "DISPATCHED" },
      })
      return { runId: id, input: calendarPlannerInputSchema.parse(run.input) }
    })
  }
  async failPlanning(user: Principal | null, raw: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted planner completion required")
    const input = z
      .object({
        runId: studioIdSchema,
        reason: z.enum(["UNAVAILABLE", "FAILED", "INTERRUPTED"]),
      })
      .strict()
      .parse(raw)
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM studio_planning_run WHERE id=${input.runId} FOR UPDATE`
      const run = await tx.studioPlanningRun.findUniqueOrThrow({
        where: { id: input.runId },
      })
      if (["RUNNING", "DISPATCHED"].includes(run.status))
        await tx.studioPlanningRun.update({
          where: { id: run.id },
          data: {
            status: input.reason,
            result: { reason: input.reason },
            finishedAt: new Date(),
          },
        })
      return {
        runId: run.id,
        status: ["RUNNING", "DISPATCHED"].includes(run.status)
          ? input.reason
          : run.status,
      }
    })
  }
  async finishPlanning(user: Principal | null, id: string, raw: unknown) {
    if (studioActor(user).kind !== "service")
      throw new ForbiddenError("Trusted planner completion required")
    const result = calendarPlanResultSchema.parse(raw)
    return this.db.$transaction(async (tx) => {
      const initial = await tx.studioPlanningRun.findUniqueOrThrow({
        where: { id: studioIdSchema.parse(id) },
      })
      await tx.$queryRaw`SELECT id FROM studio_calendar WHERE id=${initial.calendarId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM studio_planning_run WHERE id=${id} FOR UPDATE`
      const run = await tx.studioPlanningRun.findUniqueOrThrow({
        where: { id },
      })
      if (run.status !== "DISPATCHED") {
        if (studioHash(run.result) !== studioHash(result))
          throw new StudioCommandError("CONFLICT")
        return { runId: id, status: run.status }
      }
      const context = calendarPlannerInputSchema.parse(run.input),
        config = await calendarSettings(tx, run.calendarId)
      try {
        parseCalendarSuggestions(
          { items: result.items, weeks: result.weeks },
          context,
        )
      } catch {
        throw new StudioCommandError("INVALID")
      }
      const dates = new Set(result.items.map((item) => item.date))
      for (const week of result.weeks ?? [])
        for (let offset = 0; offset < 7; offset++)
          dates.add(
            new Date(Date.parse(week.startDate + "T00:00Z") + offset * 86400000)
              .toISOString()
              .slice(0, 10),
          )
      const lockedSlots = new Map<
        string,
        Awaited<ReturnType<typeof lockCalendarSlot>>
      >()
      // All result shapes use the same ascending slot-lock order.
      for (const date of [...dates].sort())
        lockedSlots.set(date, await lockCalendarSlot(tx, run.calendarId, date))
      let applied = 0,
        appliedWeeks = 0
      for (const week of result.weeks ?? []) {
        if (
          config.version !== run.version ||
          (await tx.studioPlanWeek.findUnique({
            where: {
              calendarId_startDate: {
                calendarId: run.calendarId,
                startDate: week.startDate,
              },
            },
          }))
        )
          continue
        let protectedWork = false
        for (let offset = 0; offset < 7; offset++) {
          const date = new Date(
            Date.parse(week.startDate + "T00:00Z") + offset * 86400000,
          )
            .toISOString()
            .slice(0, 10)
          const slot = lockedSlots.get(date)!
          const admittedSlot = context.slots.find(
            (entry) => entry.date === date,
          )
          if (
            !admittedSlot ||
            slot.version !== admittedSlot.version ||
            slot.manual ||
            slot.title ||
            slot.theme ||
            slot.projectId
          )
            protectedWork = true
        }
        if (protectedWork) continue
        await tx.studioPlanWeek.create({
          data: {
            calendarId: run.calendarId,
            startDate: week.startDate,
            theme: week.theme,
            // A suggested theme's source must not become a new week assignment.
            packRevisionId: null,
            provenance: {
              runId: id,
              packRevisionId: week.packRevisionId,
              instructions: result.instructions,
              effectiveDigest: result.effectiveDigest,
              sourceIndices: week.sourceIndices,
              sourceState: week.sourceIndices.length ? "SELECTED" : "MISSING",
            },
          },
        })
        applied++
        appliedWeeks++
      }
      for (const item of result.items) {
        const slot = lockedSlots.get(item.date)!
        if (
          config.version !== run.version ||
          slot.version !== item.expectedVersion ||
          slot.manual ||
          slot.projectId ||
          slot.title ||
          slot.theme
        )
          continue
        await tx.studioPlanSlot.update({
          where: { id: slot.id },
          data: {
            title: item.title,
            theme: item.theme,
            packRevisionId: item.packRevisionId,
            version: { increment: 1 },
            provenance: {
              runId: id,
              instructions: result.instructions,
              effectiveDigest: result.effectiveDigest,
              sourceIndices: item.sourceIndices,
              sourceState: item.sourceIndices.length ? "SELECTED" : "MISSING",
            },
          },
        })
        applied++
      }
      if (appliedWeeks)
        await tx.studioCalendar.update({
          where: { id: run.calendarId },
          data: { version: { increment: 1 } },
        })
      await tx.studioPlanningRun.update({
        where: { id },
        data: {
          result,
          status: applied ? "COMPLETE" : "UNCHANGED",
          finishedAt: new Date(),
        },
      })
      return { runId: id, status: applied ? "COMPLETE" : "UNCHANGED" }
    })
  }
}
