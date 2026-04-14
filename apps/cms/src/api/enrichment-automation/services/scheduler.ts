import { randomUUID } from "node:crypto"
import type { Core } from "@strapi/strapi"

import { computeNextRunAt } from "./schedule"
import {
  createManagerClientFromEnv,
  type ManagerAutomationClient,
} from "./manager-client"
import type {
  AutomationRunDispatchResult,
  AutomationRunStatus,
  ClaimedAutomation,
} from "./types"

type RunAttemptInput = {
  automationDocumentId: string
  runMode: ClaimedAutomation["runMode"]
  status: AutomationRunStatus
  scheduledFor: string
  startedAt: string
}

type RunAttemptRecord = {
  documentId: string
}

type CompleteRunAttemptInput = AutomationRunDispatchResult & {
  finishedAt: string
}

type CompleteAutomationCycleInput = {
  nextRunAt: string
  lastRunAt: string
  lastRunStatus: AutomationRunDispatchResult["status"]
  leaseToken: null
  leaseExpiresAt: null
}

export type SchedulerStore = {
  claimNextDueAutomation: (
    now: Date,
    leaseToken: string,
    leaseExpiresAt: Date,
  ) => Promise<ClaimedAutomation | null>
  createRunAttempt: (input: RunAttemptInput) => Promise<RunAttemptRecord>
  completeRunAttempt: (
    documentId: string,
    input: CompleteRunAttemptInput,
  ) => Promise<void>
  completeAutomationCycle: (
    documentId: string,
    input: CompleteAutomationCycleInput,
  ) => Promise<void>
}

export type RunDueAutomationsInput = {
  store: SchedulerStore
  managerClient: ManagerAutomationClient
  now?: Date
  maxClaims?: number
}

type RawClaimRow = {
  document_id?: string
}

type AutomationDocumentService = {
  findOne: (params: { documentId: string }) => Promise<ClaimedAutomation | null>
  update: (params: {
    documentId: string
    data: Record<string, unknown>
  }) => Promise<ClaimedAutomation | null>
}

type AutomationRunDocumentService = {
  create: (params: {
    data: Record<string, unknown>
  }) => Promise<RunAttemptRecord>
  update: (params: {
    documentId: string
    data: Record<string, unknown>
  }) => Promise<RunAttemptRecord | null>
}

function truncateErrors(errors: string[]): string[] {
  return errors
    .slice(0, 10)
    .map((error) => (error.length > 500 ? `${error.slice(0, 497)}...` : error))
}

function normalizeTargetLanguageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === "string")
}

function normalizeAutomation(document: ClaimedAutomation): ClaimedAutomation {
  return {
    ...document,
    runMode: document.runMode ?? "live",
    targetLanguageIds: normalizeTargetLanguageIds(document.targetLanguageIds),
  }
}

function automationDocs(strapi: Core.Strapi): AutomationDocumentService {
  return strapi.documents(
    "api::enrichment-automation.enrichment-automation" as never,
  ) as unknown as AutomationDocumentService
}

function automationRunDocs(strapi: Core.Strapi): AutomationRunDocumentService {
  return strapi.documents(
    "api::enrichment-automation-run.enrichment-automation-run" as never,
  ) as unknown as AutomationRunDocumentService
}

function readRows(result: unknown): RawClaimRow[] {
  if (
    typeof result === "object" &&
    result != null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: RawClaimRow[] }).rows
  }
  return []
}

export function createStrapiSchedulerStore(
  strapi: Core.Strapi,
): SchedulerStore {
  return {
    async claimNextDueAutomation(now, leaseToken, leaseExpiresAt) {
      const result = await strapi.db.connection.raw(
        `
          WITH candidate AS (
            SELECT id, document_id
            FROM enrichment_automations
            WHERE status = 'active'
              AND next_run_at <= ?::timestamptz
              AND (lease_expires_at IS NULL OR lease_expires_at <= ?::timestamptz)
            ORDER BY next_run_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE enrichment_automations automation
          SET lease_token = ?,
              lease_expires_at = ?::timestamptz,
              updated_at = ?::timestamptz
          FROM candidate
          WHERE automation.id = candidate.id
          RETURNING automation.document_id
        `,
        [
          now.toISOString(),
          now.toISOString(),
          leaseToken,
          leaseExpiresAt.toISOString(),
          now.toISOString(),
        ],
      )

      const documentId = readRows(result)[0]?.document_id
      if (!documentId) return null

      const automation = await automationDocs(strapi).findOne({ documentId })
      return automation ? normalizeAutomation(automation) : null
    },

    async createRunAttempt(input) {
      return automationRunDocs(strapi).create({
        data: {
          automation: input.automationDocumentId,
          runMode: input.runMode,
          status: input.status,
          scheduledFor: input.scheduledFor,
          startedAt: input.startedAt,
          eligibleCount: 0,
          enqueuedCount: 0,
          skippedDuplicateCount: 0,
          errorCount: 0,
          jobDocumentIds: [],
          errors: [],
          report: null,
        },
      })
    },

    async completeRunAttempt(documentId, input) {
      await automationRunDocs(strapi).update({
        documentId,
        data: {
          status: input.status,
          finishedAt: input.finishedAt,
          eligibleCount: input.eligibleCount,
          enqueuedCount: input.enqueuedCount,
          skippedDuplicateCount: input.skippedDuplicateCount,
          errorCount: input.errorCount,
          jobDocumentIds: input.jobDocumentIds.slice(0, 100),
          errors: truncateErrors(input.errors),
          report: input.report ?? null,
          summary: input.summary,
          runMode: input.runMode,
        },
      })
    },

    async completeAutomationCycle(documentId, input) {
      await automationDocs(strapi).update({
        documentId,
        data: input,
      })
    },
  }
}

async function completeCycle(input: {
  store: SchedulerStore
  automation: ClaimedAutomation
  runDocumentId: string
  now: Date
  result: AutomationRunDispatchResult
}): Promise<void> {
  const finishedAt = input.now.toISOString()
  await input.store.completeRunAttempt(input.runDocumentId, {
    ...input.result,
    finishedAt,
  })
  await input.store.completeAutomationCycle(input.automation.documentId, {
    nextRunAt: computeNextRunAt(
      input.automation.schedule,
      input.now,
    ).toISOString(),
    lastRunAt: finishedAt,
    lastRunStatus: input.result.status,
    leaseToken: null,
    leaseExpiresAt: null,
  })
}

async function retryAutomationCycleCompletion(input: {
  store: SchedulerStore
  automation: ClaimedAutomation
  now: Date
  result: AutomationRunDispatchResult
  originalError: unknown
}): Promise<void> {
  if (typeof strapi !== "undefined") {
    strapi.log.warn(
      `[enrichment-automation] Retrying automation cycle completion after dispatched run: ${
        input.originalError instanceof Error
          ? input.originalError.message
          : String(input.originalError)
      }`,
    )
  }

  const finishedAt = input.now.toISOString()
  await input.store.completeAutomationCycle(input.automation.documentId, {
    nextRunAt: computeNextRunAt(
      input.automation.schedule,
      input.now,
    ).toISOString(),
    lastRunAt: finishedAt,
    lastRunStatus: input.result.status,
    leaseToken: null,
    leaseExpiresAt: null,
  })
}

function failedDispatchResult(
  runMode: ClaimedAutomation["runMode"],
  error: unknown,
): AutomationRunDispatchResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    runMode,
    status: "failed",
    eligibleCount: 0,
    enqueuedCount: 0,
    skippedDuplicateCount: 0,
    errorCount: 1,
    jobDocumentIds: [],
    errors: [message],
    report: null,
    summary: "Automation dispatch failed.",
  }
}

export async function runDueAutomations(
  input: RunDueAutomationsInput,
): Promise<{ claimed: number }> {
  const now = input.now ?? new Date()
  const maxClaims = input.maxClaims ?? 10
  let claimed = 0

  for (let index = 0; index < maxClaims; index += 1) {
    const leaseToken = randomUUID()
    const leaseExpiresAt = new Date(now.getTime() + 10 * 60_000)
    const automation = await input.store.claimNextDueAutomation(
      now,
      leaseToken,
      leaseExpiresAt,
    )
    if (!automation) break

    claimed += 1
    const run = await input.store.createRunAttempt({
      automationDocumentId: automation.documentId,
      runMode: automation.runMode,
      status: "claimed",
      scheduledFor: automation.nextRunAt ?? now.toISOString(),
      startedAt: now.toISOString(),
    })

    let result: AutomationRunDispatchResult
    try {
      result = await input.managerClient.enqueueAutomationRun({
        automation,
        runDocumentId: run.documentId,
      })
    } catch (error) {
      await completeCycle({
        store: input.store,
        automation,
        runDocumentId: run.documentId,
        now,
        result: failedDispatchResult(automation.runMode, error),
      })
      continue
    }

    try {
      await completeCycle({
        store: input.store,
        automation,
        runDocumentId: run.documentId,
        now,
        result,
      })
    } catch (error) {
      await retryAutomationCycleCompletion({
        store: input.store,
        automation,
        now,
        result,
        originalError: error,
      })
    }
  }

  return { claimed }
}

export default {
  runDueAutomations: ({ strapi }: { strapi: Core.Strapi }) =>
    runDueAutomations({
      store: createStrapiSchedulerStore(strapi),
      managerClient: createManagerClientFromEnv(),
    }),
}
