import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { studioPublishSchema } from "@forge/studio-contracts/publication"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { StudioCalendarPublication } from "./calendar-publication"
import { StudioCommandError, StudioPublicationRejected } from "./errors"
import {
  prepareScheduledStudioPublication,
  publishPreparedStudioProject,
  StudioPublicationPreparationError,
} from "./scheduled-publication-adapter"

export function calendarDispatchFailure(error: unknown) {
  if (error instanceof StudioPublicationPreparationError)
    return {
      retry: error.code === "UNREADY" || error.code === "NOT_DUE",
      code: error.code,
    }
  if (
    error instanceof StudioPublicationRejected ||
    error instanceof StudioCommandError
  )
    return { retry: error.code === "NOT_DUE", code: error.code }
  return { retry: true, code: "SUBMISSION_UNKNOWN" }
}
const services = {
  prepare: prepareScheduledStudioPublication,
  publish: publishPreparedStudioProject,
}

/** Trusted server worker only. The lease bounds overlapping preparation; the
 * immutable submitted envelope and canonical receipt own publication identity. */
export class StudioCalendarDispatcher {
  constructor(
    private readonly db: PrismaClient,
    private readonly publication = services,
  ) {}
  async dispatch(authorizationId: string) {
    const initial = await this.db.studioScheduleAuthorization.findUniqueOrThrow(
      { where: { id: authorizationId } },
    )
    await this.db.studioScheduleDispatch.upsert({
      where: { authorizationId },
      create: { authorizationId, nextAttemptAt: initial.dueAt },
      update: {},
    })
    const now = new Date(),
      leaseId = randomUUID()
    const claimed = await this.db.studioScheduleDispatch.updateMany({
      where: {
        authorizationId,
        state: { in: ["PENDING", "RUNNING", "RETRY"] },
        nextAttemptAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        state: "RUNNING",
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + 90000),
        attempts: { increment: 1 },
      },
    })
    if (!claimed.count) return { authorizationId, status: "UNCHANGED" }
    const calendar = new StudioCalendarPublication(this.db)
    let state = "ACCEPTED",
      lastError: string | null = null
    try {
      const row = await this.db.studioScheduleAuthorization.findUniqueOrThrow({
        where: { id: authorizationId },
      })
      let envelope
      if (row.submission) {
        // Receipt lookup must precede current-state rejection, even after unpublish.
        envelope = studioPublishSchema.parse(row.submission)
      } else {
        const request = {
          projectId: row.projectId,
          expectedRevision: row.revision,
          idempotencyKey: `calendar:${row.id}`,
          approvalId: row.approvalId,
          renderAttemptId: row.renderAttemptId,
          releaseId: row.releaseId,
          schedule: {
            scheduleId: row.id,
            version: row.version,
            dueAt: row.dueAt.toISOString(),
            latestAllowedAt: row.latestAllowedAt.toISOString(),
          },
        }
        await calendar.preflight(request)
        envelope = await this.publication.prepare(
          request,
          AbortSignal.timeout(60000),
        )
        envelope = await calendar.rememberSubmission(envelope, leaseId)
      }
      await this.publication.publish(
        this.db,
        SYSTEM_PRINCIPAL,
        envelope,
        calendar.consume,
      )
    } catch (error) {
      const failure = calendarDispatchFailure(error)
      lastError = failure.code
      // One final exact receipt lookup can follow a lost response past the window.
      // A definite expiry is terminal; no readiness refresh or alternate release.
      state = failure.retry ? "RETRY" : "BLOCKED"
    }
    await this.db.studioScheduleDispatch.updateMany({
      where: { authorizationId, leaseId },
      data: {
        state,
        lastError,
        leaseId: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + 60000),
      },
    })
    return { authorizationId, status: state, error: lastError }
  }
  async tick(cursor?: string) {
    const now = new Date()
    const rows = await this.db.studioScheduleAuthorization.findMany({
      where: {
        ...(cursor ? { id: { gt: cursor } } : {}),
        dueAt: { lte: now },
        OR: [
          { dispatch: null, consumedAt: null, revokedAt: null },
          {
            dispatch: {
              state: { in: ["PENDING", "RUNNING", "RETRY"] },
              nextAttemptAt: { lte: now },
            },
          },
        ],
      },
      orderBy: { id: "asc" },
      take: 4,
      select: { id: true },
    })
    const results = []
    for (const row of rows) {
      try {
        results.push(await this.dispatch(row.id))
      } catch {
        results.push({
          authorizationId: row.id,
          status: "RETRY",
          error: "DISPATCH_UNAVAILABLE",
        })
      }
    }
    return { cursor: rows.length === 4 ? rows[3].id : undefined, results }
  }
}
