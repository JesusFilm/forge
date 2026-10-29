import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import {
  Prisma,
  type PrismaClient,
  type ManagerAutomation,
  type ManagerAutomationRun,
} from "@prisma/client"
import { z } from "zod"
import {
  automationDraftSchema,
  automationDryRunReportSchema,
  validateAutomationDraft,
  computeNextRunAt,
  formatScheduleSummary,
  type AutomationDraft,
} from "@forge/automation-contracts"
import { getManagerAutomationCandidates } from "./manager-automation-candidates"
import { hasPermission } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import {
  ConcurrentModificationError,
  ForbiddenError,
  NotFoundError,
} from "./errors"

const leaseMilliseconds = 10 * 60_000
const terminalResultSchema = z.object({
  status: z.enum(["success", "partial", "failed", "no_op"]),
  eligibleCount: z.number().int().nonnegative(),
  enqueuedCount: z.number().int().nonnegative(),
  skippedDuplicateCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  jobDocumentIds: z.array(z.string()).max(100),
  errors: z.array(z.string().max(2000)).max(100),
  summary: z.string().max(4000),
  dryRunReport: automationDryRunReportSchema.optional(),
})

export class ManagerAutomationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ManagerAutomationValidationError"
  }
}

function assertAccess(user: Principal | null) {
  if (!hasPermission(user, "write:manager-jobs")) throw new ForbiddenError()
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
function definition(row: ManagerAutomation): AutomationDraft {
  return automationDraftSchema.parse(row.definition)
}
function runRecord(row: ManagerAutomationRun) {
  const result = row.result as Record<string, unknown>
  return {
    documentId: row.id,
    automationDocumentId: row.automationId,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    runMode: row.runMode,
    scheduledFor: row.scheduledFor.toISOString(),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    eligibleCount: result.eligibleCount ?? 0,
    enqueuedCount: result.enqueuedCount ?? 0,
    skippedDuplicateCount: result.skippedDuplicateCount ?? 0,
    errorCount: result.errorCount ?? 0,
    jobDocumentIds: result.jobDocumentIds ?? [],
    errors: result.errors ?? [],
    summary: result.summary ?? null,
    report: result.dryRunReport ?? null,
  }
}
function automationRecord(
  row: ManagerAutomation & { runs?: ManagerAutomationRun[] },
) {
  const draft = definition(row)
  return {
    ...draft,
    documentId: row.id,
    status: row.status,
    scheduleSummary: formatScheduleSummary(draft.schedule),
    timezone: draft.schedule.timezone,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row.lastRunStatus,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    runs: (row.runs ?? []).map(runRecord),
  }
}
export type ManagerAutomationRecord = ReturnType<typeof automationRecord>
const withRuns = { runs: { orderBy: { startedAt: "desc" as const }, take: 5 } }

export class ManagerAutomationService {
  constructor(private readonly db: PrismaClient) {}

  async candidates(user: Principal | null, input: unknown) {
    return getManagerAutomationCandidates(this.db, user, input)
  }
  async languages(user: Principal | null) {
    assertAccess(user)
    const languages = await this.db.language.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        coreId: true,
        name: true,
        locales: {
          where: { deletedAt: null, locale: "en" },
          select: { value: true },
          take: 1,
        },
      },
      orderBy: { id: "asc" },
    })
    return languages.map((language) => ({
      coreId: language.coreId ?? language.id,
      name:
        language.locales[0]?.value ??
        (typeof language.name === "object" &&
        language.name &&
        "en" in language.name
          ? String(language.name.en)
          : (language.coreId ?? language.id)),
    }))
  }
  async list(user: Principal | null) {
    assertAccess(user)
    return (
      await this.db.managerAutomation.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 100,
        include: withRuns,
      })
    ).map(automationRecord)
  }
  async get(user: Principal | null, id: string) {
    assertAccess(user)
    const row = await this.db.managerAutomation.findUnique({
      where: { id },
      include: withRuns,
    })
    return row ? automationRecord(row) : null
  }
  async getRun(user: Principal | null, id: string) {
    assertAccess(user)
    const row = await this.db.managerAutomationRun.findUnique({ where: { id } })
    return row ? runRecord(row) : null
  }
  async findRun(
    user: Principal | null,
    automationId: string,
    idempotencyKey: string,
  ) {
    assertAccess(user)
    const row = await this.db.managerAutomationRun.findUnique({
      where: { automationId_idempotencyKey: { automationId, idempotencyKey } },
    })
    return row ? runRecord(row) : null
  }
  async hasInFlight(user: Principal | null, automationId: string) {
    assertAccess(user)
    return (
      (await this.db.managerAutomationRun.count({
        where: {
          activeAutomationId: automationId,
          automation: { leaseExpiresAt: { gt: new Date() } },
        },
      })) > 0
    )
  }
  async create(user: Principal | null, input: unknown) {
    assertAccess(user)
    const validation = validateAutomationDraft(input)
    if (!validation.success)
      throw new ManagerAutomationValidationError(
        validation.errors
          .join(" ")
          .replace(
            "Choose one target language",
            "Choose exactly one target language",
          ),
      )
    const draft = validation.data
    if (
      draft.template !== "target_subtitles_missing" &&
      draft.targetLanguageIds.length
    )
      throw new ManagerAutomationValidationError(
        "Target languages apply only to target-subtitle automations",
      )
    const languages = await this.db.language.findMany({
      where: {
        deletedAt: null,
        OR: [
          { id: { in: draft.targetLanguageIds } },
          { coreId: { in: draft.targetLanguageIds } },
        ],
      },
      select: { id: true, coreId: true },
    })
    if (
      draft.targetLanguageIds.some(
        (id) =>
          !languages.some(
            (language) => language.id === id || language.coreId === id,
          ),
      )
    )
      throw new ManagerAutomationValidationError("Unknown target language")
    // Stable Core IDs preserve the Manager selection and duplicate-key contract.
    draft.targetLanguageIds = draft.targetLanguageIds.map(
      (id) =>
        languages.find(
          (language) => language.id === id || language.coreId === id,
        )!.coreId ?? id,
    )
    return automationRecord(
      await this.db.managerAutomation.create({
        data: {
          definition: json(draft),
          nextRunAt: computeNextRunAt(draft.schedule),
        },
      }),
    )
  }
  async updateStatus(
    user: Principal | null,
    id: string,
    status: "active" | "paused",
  ) {
    assertAccess(user)
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        ManagerAutomation[]
      >`SELECT * FROM manager_automation WHERE id=${id} FOR UPDATE`
      if (!rows.length) throw new NotFoundError("Automation", id)
      const current = await tx.managerAutomation.findUniqueOrThrow({
        where: { id },
      })
      // Pausing stops future claims; an already admitted run keeps its fence.
      const updated = await tx.managerAutomation.update({
        where: { id },
        data: {
          status,
          nextRunAt:
            status === "active"
              ? computeNextRunAt(definition(current).schedule)
              : null,
        },
        include: withRuns,
      })
      return automationRecord(updated)
    })
  }
  async claim(user: Principal | null, id: string, now = new Date()) {
    assertAccess(user)
    return this.db.$transaction(async (tx) => {
      // Wait for the requested parent before recovery. SKIP LOCKED alone can
      // skip it, then a later UPDATE steal its lease without retiring its run.
      await tx.$queryRaw`SELECT id FROM manager_automation WHERE id=${id} FOR UPDATE`
      await this.recoverExpired(tx, now, id)
      const token = randomUUID(),
        expires = new Date(now.getTime() + leaseMilliseconds)
      const updated = await tx.managerAutomation.updateMany({
        where: {
          id,
          leaseToken: null,
          leaseExpiresAt: null,
          runs: { none: { activeAutomationId: id } },
        },
        data: { leaseToken: token, leaseExpiresAt: expires },
      })
      return updated.count
        ? {
            documentId: id,
            leaseToken: token,
            leaseExpiresAt: expires.toISOString(),
          }
        : null
    })
  }
  async release(user: Principal | null, id: string, leaseToken: string) {
    assertAccess(user)
    return (
      (
        await this.db.managerAutomation.updateMany({
          where: { id, leaseToken, runs: { none: { activeAutomationId: id } } },
          data: { leaseToken: null, leaseExpiresAt: null },
        })
      ).count > 0
    )
  }
  async beginDispatch(user: Principal | null, id: string, leaseToken: string) {
    assertAccess(user)
    const now = new Date()
    return (
      (
        await this.db.managerAutomationRun.updateMany({
          where: {
            id,
            leaseToken,
            status: "running",
            dispatchStartedAt: null,
            automation: { leaseToken, leaseExpiresAt: { gt: now } },
          },
          data: { dispatchStartedAt: now },
        })
      ).count === 1
    )
  }
  async createRun(
    user: Principal | null,
    input: {
      automationDocumentId: string
      leaseToken: string
      runMode: "live" | "dry_run"
      scheduledFor: string
      idempotencyKey?: string
    },
  ) {
    assertAccess(user)
    const now = new Date(),
      automationId = input.automationDocumentId
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM manager_automation WHERE id=${automationId} FOR UPDATE`
      if (input.idempotencyKey) {
        const existing = await tx.managerAutomationRun.findUnique({
          where: {
            automationId_idempotencyKey: {
              automationId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        })
        if (existing) return runRecord(existing)
      }
      const automation = await tx.managerAutomation.findFirst({
        where: {
          id: automationId,
          leaseToken: input.leaseToken,
          leaseExpiresAt: { gt: now },
        },
      })
      if (!automation)
        throw new ConcurrentModificationError("Automation lease", automationId)
      // Manual reports always stay dry-run, irrespective of the definition's live mode.
      if (input.runMode !== "dry_run")
        throw new ManagerAutomationValidationError(
          "Manual automation runs must use dry_run",
        )
      const run = await tx.managerAutomationRun.create({
        data: {
          automationId,
          activeAutomationId: automationId,
          leaseToken: input.leaseToken,
          runMode: "dry_run",
          scheduledFor: z.coerce.date().parse(input.scheduledFor),
          idempotencyKey: input.idempotencyKey,
        },
      })
      return runRecord(run)
    })
  }
  async completeRun(
    user: Principal | null,
    id: string,
    input: unknown,
    leaseToken: string,
  ) {
    assertAccess(user)
    const result = terminalResultSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const identity = await tx.managerAutomationRun.findUniqueOrThrow({
        where: { id },
        select: { automationId: true },
      })
      await tx.$queryRaw`SELECT id FROM manager_automation WHERE id=${identity.automationId} FOR UPDATE`
      const run = await tx.managerAutomationRun.findUniqueOrThrow({
        where: { id },
      })
      const automation = await tx.managerAutomation.findUniqueOrThrow({
        where: { id: run.automationId },
      })
      if (run.leaseToken !== leaseToken)
        throw new ConcurrentModificationError("Automation run", id)
      if (run.status !== "running") {
        if (isDeepStrictEqual(run.result, json(result))) return runRecord(run)
        throw new ConcurrentModificationError("Completed automation run", id)
      }
      if (automation.leaseToken !== leaseToken)
        throw new ConcurrentModificationError("Automation run", id)
      if (
        automation.leaseExpiresAt == null ||
        automation.leaseExpiresAt <= new Date()
      )
        throw new ConcurrentModificationError("Expired automation run", id)
      if (
        run.runMode === "dry_run" &&
        (result.enqueuedCount !== 0 || result.jobDocumentIds.length !== 0)
      )
        throw new ManagerAutomationValidationError(
          "Dry runs cannot enqueue jobs",
        )
      const updated = await tx.managerAutomationRun.update({
        where: { id },
        data: {
          status: result.status,
          result: json(result),
          activeAutomationId: null,
          finishedAt: new Date(),
        },
      })
      await tx.managerAutomation.update({
        where: { id: run.automationId },
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          lastRunAt: run.startedAt,
          lastRunStatus: result.status,
          ...(run.scheduled
            ? {
                nextRunAt:
                  automation.status === "active"
                    ? computeNextRunAt(definition(automation).schedule)
                    : null,
              }
            : {}),
        },
      })
      return runRecord(updated)
    })
  }
  async failIfInFlight(
    user: Principal | null,
    id: string,
    error: string,
    leaseToken: string,
  ) {
    assertAccess(user)
    const run = await this.db.managerAutomationRun.findUnique({ where: { id } })
    if (!run || run.status !== "running") return false
    await this.completeRun(
      user,
      id,
      {
        status: "failed",
        eligibleCount: 0,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 1,
        jobDocumentIds: [],
        errors: [error],
        summary: "Automation run failed.",
      },
      leaseToken,
    )
    return true
  }
  async claimDue(user: Principal | null, now = new Date()) {
    assertAccess(user)
    return this.db.$transaction(async (tx) => {
      await this.recoverExpired(tx, now)
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM manager_automation WHERE status='active' AND next_run_at<=${now} AND lease_token IS NULL ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1`
      if (!rows[0]) return null
      const row = await tx.managerAutomation.findUniqueOrThrow({
          where: { id: rows[0].id },
        }),
        token = randomUUID()
      const run = await tx.managerAutomationRun.create({
        data: {
          automationId: row.id,
          activeAutomationId: row.id,
          leaseToken: token,
          scheduled: true,
          runMode: definition(row).runMode,
          scheduledFor: row.nextRunAt!,
        },
      })
      const claimed = await tx.managerAutomation.update({
        where: { id: row.id },
        data: {
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        },
      })
      return {
        automation: automationRecord(claimed),
        run: runRecord(run),
        leaseToken: token,
      }
    })
  }
  private async recoverExpired(
    tx: Prisma.TransactionClient,
    now: Date,
    id?: string,
  ) {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM manager_automation WHERE lease_expires_at<=${now} ${id ? Prisma.sql`AND id=${id}` : Prisma.empty} ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 25`,
    )
    for (const { id: automationId } of rows) {
      const row = await tx.managerAutomation.findUniqueOrThrow({
        where: { id: automationId },
      })
      const runs = await tx.managerAutomationRun.findMany({
        where: {
          activeAutomationId: automationId,
          leaseToken: row.leaseToken!,
        },
      })
      await tx.managerAutomationRun.updateMany({
        where: {
          activeAutomationId: automationId,
          leaseToken: row.leaseToken!,
        },
        data: {
          status: "failed",
          activeAutomationId: null,
          finishedAt: now,
          result: json({
            eligibleCount: 0,
            enqueuedCount: 0,
            skippedDuplicateCount: 0,
            errorCount: 1,
            jobDocumentIds: [],
            errors: ["Run lease expired before completion."],
            summary: "Interrupted automation run.",
          }),
        },
      })
      await tx.managerAutomation.update({
        where: { id: automationId },
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          ...(runs.some((run) => run.scheduled)
            ? {
                lastRunAt: runs[0].startedAt,
                lastRunStatus: "failed",
                nextRunAt:
                  row.status === "active"
                    ? computeNextRunAt(definition(row).schedule, now)
                    : null,
              }
            : {}),
        },
      })
    }
  }
}
