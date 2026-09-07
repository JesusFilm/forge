import { assertStudioPublicationEligibility } from "./publication-readiness-resolver"
import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { Principal } from "@/auth/principal"
import {
  calendarAuthorizationSchema,
  calendarDays,
  calendarCommandSchema,
  resolveCalendarTime,
} from "@forge/studio-contracts/calendar"
import { studioIdSchema } from "@forge/studio-contracts"
import {
  studioPublishSchema,
  type StudioPublish,
  type StudioScheduledPublicationPreparation,
} from "@forge/studio-contracts/publication"
import {
  calendarCommand,
  calendarSelectedSourceSql,
  calendarSettings,
  lockCalendarSlot,
  calendarOperator,
} from "./calendar"
import { assertEditable, lockProject, studioHash } from "./state"
import { StudioCommandError } from "./errors"
import type { StudioSchedulePublicationHook } from "./scheduled-publication"

/** Calendar authorization is durable human intent, never a fabricated service principal. */
export class StudioCalendarPublication {
  constructor(private readonly db: PrismaClient) {}
  async authorize(user: Principal | null, raw: unknown) {
    const input = calendarAuthorizationSchema.parse(raw)
    return calendarCommand(
      this.db,
      user,
      "authorize-schedule",
      input,
      async (tx) => {
        const operatorId = await calendarOperator(tx, user)
        await tx.$queryRaw`SELECT id FROM studio_calendar WHERE id=${input.calendarId} FOR UPDATE`
        const config = await calendarSettings(tx, input.calendarId)
        if (config.version !== input.expectedCalendarVersion)
          throw new StudioCommandError("STALE_BINDING")
        if (!calendarDays(config.settings.timeZone).includes(input.date))
          throw new StudioCommandError("INVALID")
        const project = await lockProject(tx, input.projectId)
        assertEditable(project, input.expectedRevision)
        const slot = await lockCalendarSlot(tx, input.calendarId, input.date)
        if (
          slot.version !== input.expectedVersion ||
          slot.projectId !== input.projectId
        )
          throw new StudioCommandError("STALE_BINDING")
        await requireSelectedSource(tx, input.projectId, input.expectedRevision)
        await assertStudioPublicationEligibility(tx, input, operatorId)
        const dueAt = resolveCalendarTime(
          input.date,
          config.settings.publishTime,
          config.settings.timeZone,
          input.occurrence,
        )
        const latestAllowedAt = new Date(
          Date.parse(dueAt) + config.settings.deliveryWindowMinutes * 60000,
        ).toISOString()
        if (Date.parse(latestAllowedAt) < Date.now())
          throw new StudioCommandError("DELIVERY_EXPIRED")
        await tx.studioScheduleAuthorization.updateMany({
          where: { slotId: slot.id, consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        const version = slot.version + 1,
          id = randomUUID()
        await tx.studioScheduleAuthorization.create({
          data: {
            id,
            slotId: slot.id,
            version,
            projectId: project.id,
            revision: project.currentRevision,
            approvalId: input.approvalId,
            renderAttemptId: input.renderAttemptId,
            releaseId: input.releaseId,
            operatorId,
            dueAt: new Date(dueAt),
            latestAllowedAt: new Date(latestAllowedAt),
          },
        })
        await tx.studioPlanSlot.update({
          where: { id: slot.id },
          data: { version },
        })
        return {
          authorizationId: id,
          binding: { scheduleId: id, version, dueAt, latestAllowedAt },
        }
      },
    )
  }
  async cancel(user: Principal | null, raw: unknown) {
    const input = calendarCommandSchema
      .extend({ authorizationId: studioIdSchema })
      .parse(raw)
    return calendarCommand(
      this.db,
      user,
      "cancel-schedule",
      input,
      async (tx) => {
        const initial = await tx.studioScheduleAuthorization.findUniqueOrThrow({
          where: { id: input.authorizationId },
          include: { slot: true },
        })
        if (initial.slot.calendarId !== input.calendarId)
          throw new StudioCommandError("STALE_BINDING")
        await lockProject(tx, initial.projectId)
        const slot = await lockCalendarSlot(
          tx,
          input.calendarId,
          initial.slot.date,
        )
        if (slot.version !== input.expectedVersion)
          throw new StudioCommandError("CONFLICT")
        const row = await tx.studioScheduleAuthorization.findUniqueOrThrow({
          where: { id: input.authorizationId },
        })
        if (row.consumedAt) throw new StudioCommandError("ALREADY_CONSUMED")
        await tx.studioScheduleAuthorization.update({
          where: { id: row.id },
          data: { revokedAt: row.revokedAt ?? new Date() },
        })
        await tx.studioPlanSlot.update({
          where: { id: slot.id },
          data: { version: { increment: 1 } },
        })
        return {
          authorizationId: row.id,
          version: slot.version + 1,
          status: "CANCELLED",
        }
      },
    )
  }
  private async validateAuthorization(
    tx: import("@prisma/client").Prisma.TransactionClient,
    input: StudioScheduledPublicationPreparation,
  ) {
    const initial = await tx.studioScheduleAuthorization.findUnique({
      where: { id: input.schedule.scheduleId },
      include: { slot: true },
    })
    if (!initial) throw new StudioCommandError("STALE_BINDING")
    // Caller already holds the project lock. This is the second lock in the global order.
    const slot = await lockCalendarSlot(
      tx,
      initial.slot.calendarId,
      initial.slot.date,
    )
    const row = await tx.studioScheduleAuthorization.findUniqueOrThrow({
      where: { id: initial.id },
    })
    if (row.revokedAt) throw new StudioCommandError("CANCELLED")
    if (row.consumedAt) throw new StudioCommandError("ALREADY_CONSUMED")
    if (
      row.version !== input.schedule.version ||
      slot.version !== row.version ||
      slot.projectId !== input.projectId ||
      row.projectId !== input.projectId ||
      row.revision !== input.expectedRevision ||
      row.approvalId !== input.approvalId ||
      row.renderAttemptId !== input.renderAttemptId ||
      row.releaseId !== input.releaseId ||
      row.dueAt.toISOString() !== input.schedule.dueAt ||
      row.latestAllowedAt.toISOString() !== input.schedule.latestAllowedAt
    )
      throw new StudioCommandError("STALE_BINDING")
    const membership = await tx.$queryRaw<
      { user_id: string }[]
    >`SELECT user_id FROM manager_membership WHERE user_id=${row.operatorId} AND role='OPERATOR' AND revoked_at IS NULL FOR SHARE`
    if (!membership.length)
      throw new StudioCommandError("AUTHORIZATION_REVOKED")
    const now = new Date()
    if (now < row.dueAt) throw new StudioCommandError("NOT_DUE")
    if (now > row.latestAllowedAt)
      throw new StudioCommandError("DELIVERY_EXPIRED")
    await requireSelectedSource(tx, input.projectId, input.expectedRevision)
    return row
  }
  async preflight(input: StudioScheduledPublicationPreparation) {
    return this.db.$transaction(async (tx) => {
      await lockProject(tx, input.projectId)
      const row = await this.validateAuthorization(tx, input)
      await assertStudioPublicationEligibility(tx, input, row.operatorId)
    })
  }
  readonly consume: StudioSchedulePublicationHook = async (tx, input) => {
    const row = await this.validateAuthorization(tx, input)
    await tx.studioScheduleAuthorization.update({
      where: { id: row.id },
      data: { consumedAt: new Date(), outcome: "ACCEPTED" },
    })
  }
  /** Trusted dispatcher only: commit an envelope BEFORE it can be submitted. The
   * final460 adapter resolves readiness; retries never replace an uncertain envelope. */
  async rememberSubmission(raw: StudioPublish, leaseId?: string) {
    const input = studioPublishSchema.parse(raw)
    if (!input.schedule) throw new StudioCommandError("INVALID")
    return this.db.$transaction(async (tx) => {
      await lockProject(tx, input.projectId)
      const initial = await tx.studioScheduleAuthorization.findUniqueOrThrow({
        where: { id: input.schedule!.scheduleId },
        include: { slot: true },
      })
      await lockCalendarSlot(tx, initial.slot.calendarId, initial.slot.date)
      const row = await tx.studioScheduleAuthorization.findUniqueOrThrow({
        where: { id: initial.id },
      })
      if (leaseId) {
        await tx.$queryRaw`SELECT authorization_id FROM studio_schedule_dispatch WHERE authorization_id=${row.id} FOR UPDATE`
        const dispatch = await tx.studioScheduleDispatch.findUnique({
          where: { authorizationId: row.id },
        })
        if (
          !dispatch ||
          dispatch.leaseId !== leaseId ||
          !dispatch.leaseExpiresAt ||
          dispatch.leaseExpiresAt <= new Date()
        )
          throw new StudioCommandError("STALE_BINDING")
      }
      if (row.submission) {
        const prior = studioPublishSchema.parse(row.submission)
        if (studioHash(prior) !== studioHash(input))
          throw new StudioCommandError("CONFLICT")
        return prior
      }
      if (row.revokedAt || row.consumedAt)
        throw new StudioCommandError("CANCELLED")
      if (
        row.projectId !== input.projectId ||
        row.revision !== input.expectedRevision ||
        row.releaseId !== input.releaseId ||
        row.approvalId !== input.approvalId ||
        row.renderAttemptId !== input.renderAttemptId ||
        row.version !== input.schedule!.version ||
        row.dueAt.toISOString() !== input.schedule!.dueAt ||
        row.latestAllowedAt.toISOString() !== input.schedule!.latestAllowedAt
      )
        throw new StudioCommandError("STALE_BINDING")
      await tx.studioScheduleAuthorization.update({
        where: { id: row.id },
        data: { submission: input },
      })
      return input
    })
  }
}

async function requireSelectedSource(
  tx: import("@prisma/client").Prisma.TransactionClient,
  projectId: string,
  revision: number,
) {
  const rows = await tx.$queryRaw<
    Array<{ selected: boolean }>
  >`SELECT (${calendarSelectedSourceSql}) AS selected FROM studio_project_revision revision WHERE revision.project_id=${projectId} AND revision.number=${revision}`
  if (!rows[0]?.selected) throw new StudioCommandError("UNREADY")
}
