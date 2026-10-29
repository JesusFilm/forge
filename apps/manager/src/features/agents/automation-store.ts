import { randomUUID } from "node:crypto"
import { env } from "@/config/env"
import { AdminGraphqlClient } from "@/backend/admin-client"
import { getAdminManagerServiceBearer } from "@/lib/admin-manager-session"
import {
  getCmsGateway,
  readMockCmsState,
  updateMockCmsState as updateMockState,
  type CmsGateway,
} from "@/cms/gateway"
import type {
  AutomationDraft,
  AutomationRunMode,
  EnrichmentAutomation,
  EnrichmentAutomationRun,
} from "./automation-contract"
import type { AutomationRunResult } from "./automation-runner"

// Demo storage is single-process. Serialize automation updates on its singleton
// gateway so async snapshot reads cannot lose a competing mock claim/run update.
const mockUpdates = new WeakMap<CmsGateway, Promise<unknown>>()
function updateMockCmsState(
  ...[gateway, updater]: Parameters<typeof updateMockState>
) {
  const next = (mockUpdates.get(gateway) ?? Promise.resolve()).then(() =>
    updateMockState(gateway, updater),
  )
  mockUpdates.set(
    gateway,
    next.catch(() => undefined),
  )
  return next
}

type AutomationDryRunClaim = {
  documentId: string
  leaseToken: string
  leaseExpiresAt: string
}
export class AutomationStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AutomationStoreError"
  }
}
export async function getAdminAutomationAdapter() {
  if (!env.ADMIN_GRAPHQL_URL)
    throw new AutomationStoreError("Admin automation backend is not configured")
  const apiKey = await getAdminManagerServiceBearer()
  return new AdminGraphqlClient({ graphqlUrl: env.ADMIN_GRAPHQL_URL, apiKey })
    .automations
}
function nextMockDocumentId(prefix: string, values: string[]) {
  return `${prefix}-${
    values.reduce((max, value) => {
      const match = value.match(new RegExp(`^${prefix}-(\\d+)$`))
      return match ? Math.max(max, Number(match[1])) : max
    }, 0) + 1
  }`
}
export async function getAutomation(
  documentId: string,
): Promise<EnrichmentAutomation | null> {
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    return (
      mockState.readModels.automations.find(
        (automation) => automation.documentId === documentId,
      ) ?? null
    )
  }

  return (await getAdminAutomationAdapter()).get(documentId)
}

export async function listAutomations(): Promise<EnrichmentAutomation[]> {
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    return mockState.readModels.automations
  }

  return (await getAdminAutomationAdapter()).list()
}

export async function getAutomationRun(
  documentId: string,
): Promise<EnrichmentAutomationRun | null> {
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    return (
      mockState.readModels.automations
        .flatMap((automation) => automation.runs)
        .find((run) => run.documentId === documentId) ?? null
    )
  }

  return (await getAdminAutomationAdapter()).getRun(documentId)
}

export async function getAutomationRunByIdempotencyKey(input: {
  automationDocumentId: string
  idempotencyKey: string
}): Promise<EnrichmentAutomationRun | null> {
  const state = await readMockCmsState(getCmsGateway())
  if (state) {
    return (
      state.readModels.automations
        .find(
          (automation) => automation.documentId === input.automationDocumentId,
        )
        ?.runs.find(
          (run) =>
            run.automationDocumentId === input.automationDocumentId &&
            run.idempotencyKey === input.idempotencyKey,
        ) ?? null
    )
  }
  return (await getAdminAutomationAdapter()).findRun(
    input.automationDocumentId,
    input.idempotencyKey,
  )
}

/** Consume the admitted run once. An existing key returned by createRun is not admission. */
export async function beginAutomationRunDispatch(
  runDocumentId: string,
  leaseToken: string,
): Promise<boolean> {
  const gateway = getCmsGateway()
  if (await readMockCmsState(gateway)) {
    let admitted = false
    await updateMockCmsState(gateway, (state) => ({
      ...state,
      readModels: {
        ...state.readModels,
        automations: state.readModels.automations.map((automation) => {
          if (
            automation.leaseToken !== leaseToken ||
            !automation.leaseExpiresAt ||
            Date.parse(automation.leaseExpiresAt) <= Date.now()
          )
            return automation
          return {
            ...automation,
            runs: automation.runs.map((run) => {
              if (
                run.documentId !== runDocumentId ||
                run.status !== "running" ||
                !("leaseToken" in run) ||
                run.leaseToken !== leaseToken ||
                ("dispatchStartedAt" in run && run.dispatchStartedAt)
              )
                return run
              admitted = true
              return { ...run, dispatchStartedAt: new Date().toISOString() }
            }),
          }
        }),
      },
    }))
    return admitted
  }
  return (await getAdminAutomationAdapter()).beginDispatch(
    runDocumentId,
    leaseToken,
  )
}

export async function hasInFlightAutomationRun(
  automationDocumentId: string,
): Promise<boolean> {
  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    const automation = mockState.readModels.automations.find(
      (candidate) => candidate.documentId === automationDocumentId,
    )
    return Boolean(
      automation?.runs.some(
        (run) => run.status === "claimed" || run.status === "running",
      ),
    )
  }

  return (await getAdminAutomationAdapter()).hasInFlight(automationDocumentId)
}

export async function claimAutomationDryRun(
  automationDocumentId: string,
): Promise<AutomationDryRunClaim | null> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    let claim: AutomationDryRunClaim | null = null
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) => {
          if (
            automation.documentId !== automationDocumentId ||
            (automation.leaseToken &&
              automation.leaseExpiresAt &&
              Date.parse(automation.leaseExpiresAt) > Date.now()) ||
            automation.runs.some(
              (run) => run.status === "claimed" || run.status === "running",
            )
          )
            return automation
          claim = {
            documentId: automationDocumentId,
            leaseToken: randomUUID(),
            leaseExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          }
          return {
            ...automation,
            leaseToken: claim.leaseToken,
            leaseExpiresAt: claim.leaseExpiresAt,
          }
        }),
      },
    }))
    return claim
  }

  return (await getAdminAutomationAdapter()).claim(automationDocumentId)
}

export async function releaseAutomationDryRunClaim(
  automationDocumentId: string,
  leaseToken: string,
): Promise<boolean> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    let released = false
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) => {
          if (
            automation.documentId !== automationDocumentId ||
            automation.leaseToken !== leaseToken ||
            automation.runs.some(
              (run) => run.status === "claimed" || run.status === "running",
            )
          )
            return automation
          released = true
          return { ...automation, leaseToken: null, leaseExpiresAt: null }
        }),
      },
    }))
    return released
  }

  return (await getAdminAutomationAdapter()).release(
    automationDocumentId,
    leaseToken,
  )
}

export async function markAutomationRunFailedIfInFlight(input: {
  leaseToken?: string
  runDocumentId: string
  error: string
  finishedAt: string
}): Promise<boolean> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    let updated = false
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) => ({
          ...automation,
          runs: automation.runs.map((run) => {
            if (
              run.documentId !== input.runDocumentId ||
              (run.status !== "claimed" && run.status !== "running")
            ) {
              return run
            }
            if (
              input.leaseToken &&
              (automation.leaseToken !== input.leaseToken ||
                !("leaseToken" in run) ||
                run.leaseToken !== input.leaseToken ||
                !automation.leaseExpiresAt ||
                Date.parse(automation.leaseExpiresAt) <= Date.now())
            )
              return run
            updated = true
            return {
              ...run,
              status: "failed",
              finishedAt: input.finishedAt,
              errorCount: 1,
              errors: [input.error],
              summary: "Automation dry run failed.",
            }
          }),
        })),
      },
    }))
    return updated
  }

  if (!input.leaseToken)
    throw new AutomationStoreError("Run lease token required")
  return (await getAdminAutomationAdapter()).fail(
    input.runDocumentId,
    input.leaseToken,
    input.error,
  )
}

export async function createAutomation(
  input: AutomationDraft & {
    status: "active"
    scheduleSummary: string
    timezone: string
    nextRunAt: string
  },
): Promise<EnrichmentAutomation> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const automation: EnrichmentAutomation = {
      documentId: nextMockDocumentId(
        "mock-automation",
        mockState.readModels.automations.map(
          (candidate) => candidate.documentId,
        ),
      ),
      name: input.name,
      template: input.template,
      status: input.status,
      runMode: input.runMode,
      schedule: input.schedule,
      scheduleSummary: input.scheduleSummary,
      timezone: input.timezone,
      nextRunAt: input.nextRunAt,
      lastRunAt: null,
      lastRunStatus: null,
      refreshMode: input.refreshMode,
      targetLanguageIds: input.targetLanguageIds,
      maxVideosPerRun: input.maxVideosPerRun,
      leaseToken: null,
      leaseExpiresAt: null,
      runs: [],
    }
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: [automation, ...current.readModels.automations],
      },
    }))
    return automation
  }

  return (await getAdminAutomationAdapter()).create(input)
}

export async function createAutomationRun(input: {
  leaseToken?: string
  idempotencyKey?: string
  automationDocumentId: string
  runMode: AutomationRunMode
  scheduledFor: string
  startedAt: string
}): Promise<EnrichmentAutomationRun> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    let created: EnrichmentAutomationRun | null = null
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) => {
          if (automation.documentId !== input.automationDocumentId)
            return automation
          const existing =
            input.idempotencyKey &&
            automation.runs.find(
              (run) => run.idempotencyKey === input.idempotencyKey,
            )
          if (existing) {
            created = existing
            return automation
          }
          if (input.runMode !== "dry_run")
            throw new AutomationStoreError(
              "Manual automation runs must use dry_run",
            )
          if (
            input.leaseToken &&
            (automation.leaseToken !== input.leaseToken ||
              !automation.leaseExpiresAt ||
              Date.parse(automation.leaseExpiresAt) <= Date.now())
          ) {
            throw new AutomationStoreError("Run lease token required")
          }
          const run = {
            documentId: nextMockDocumentId(
              "mock-automation-run",
              current.readModels.automations.flatMap((item) =>
                item.runs.map((run) => run.documentId),
              ),
            ),
            automationDocumentId: input.automationDocumentId,
            idempotencyKey: input.idempotencyKey ?? null,
            leaseToken: input.leaseToken,
            status: "running" as const,
            runMode: input.runMode,
            scheduledFor: input.scheduledFor,
            startedAt: input.startedAt,
            finishedAt: null,
            eligibleCount: 0,
            enqueuedCount: 0,
            skippedDuplicateCount: 0,
            errorCount: 0,
            jobDocumentIds: [],
            errors: [],
            summary: null,
          }
          created = run
          return { ...automation, runs: [run, ...automation.runs] }
        }),
      },
    }))
    if (!created) throw new AutomationStoreError("Automation not found")
    return created
  }

  if (!input.leaseToken)
    throw new AutomationStoreError("Run lease token required")
  return (await getAdminAutomationAdapter()).createRun(input)
}

export async function completeAutomationRun(input: {
  leaseToken?: string
  runDocumentId: string
  result: AutomationRunResult
  finishedAt: string
}): Promise<EnrichmentAutomationRun> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    let completedRun: EnrichmentAutomationRun | null = null
    await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) => {
          const hasRun = automation.runs.some(
            (candidate) => candidate.documentId === input.runDocumentId,
          )
          const runs = automation.runs.map((run) => {
            if (run.documentId !== input.runDocumentId) {
              return run
            }

            if (
              input.leaseToken &&
              (automation.leaseToken !== input.leaseToken ||
                !("leaseToken" in run) ||
                run.leaseToken !== input.leaseToken ||
                !automation.leaseExpiresAt ||
                Date.parse(automation.leaseExpiresAt) <= Date.now())
            ) {
              throw new AutomationStoreError("Run lease token required")
            }
            if (
              run.runMode === "dry_run" &&
              (input.result.enqueuedCount !== 0 ||
                input.result.jobDocumentIds.length !== 0)
            ) {
              throw new AutomationStoreError("Dry runs cannot enqueue jobs")
            }
            completedRun = {
              ...run,
              status: input.result.status,
              finishedAt: input.finishedAt,
              eligibleCount: input.result.eligibleCount,
              enqueuedCount: input.result.enqueuedCount,
              skippedDuplicateCount: input.result.skippedDuplicateCount,
              errorCount: input.result.errorCount,
              jobDocumentIds: input.result.jobDocumentIds,
              errors: input.result.errors,
              summary: input.result.summary,
              ...(input.result.dryRunReport
                ? {
                    runMode: "dry_run" as const,
                    report: input.result.dryRunReport,
                  }
                : {}),
            }
            return completedRun
          })

          if (!hasRun || !completedRun) {
            return automation
          }

          return {
            ...automation,
            runs,
            lastRunAt: input.finishedAt,
            lastRunStatus: input.result.status,
          }
        }),
      },
    }))

    if (!completedRun) {
      throw new Error("Failed to complete enrichment automation run")
    }
    return completedRun
  }

  if (!input.leaseToken)
    throw new AutomationStoreError("Run lease token required")
  return (await getAdminAutomationAdapter()).complete(
    input.runDocumentId,
    input.leaseToken,
    input.result,
  )
}

export async function updateAutomationStatus(
  documentId: string,
  input: { status: "active" | "paused"; nextRunAt: string | null },
): Promise<EnrichmentAutomation> {
  const gateway = getCmsGateway()
  const mockState = await readMockCmsState(gateway)
  if (mockState) {
    const nextState = await updateMockCmsState(gateway, (current) => ({
      ...current,
      readModels: {
        ...current.readModels,
        automations: current.readModels.automations.map((automation) =>
          automation.documentId === documentId
            ? {
                ...automation,
                status: input.status,
                nextRunAt: input.nextRunAt,
              }
            : automation,
        ),
      },
    }))
    const automation =
      nextState?.readModels.automations.find(
        (candidate) => candidate.documentId === documentId,
      ) ?? null
    if (!automation) {
      throw new Error("Failed to update enrichment automation")
    }
    return automation
  }

  return (await getAdminAutomationAdapter()).updateStatus(
    documentId,
    input.status,
  )
}

export async function findMissingLanguageIds(
  languageIds: string[],
): Promise<string[]> {
  if (languageIds.length === 0) return []

  const mockState = await readMockCmsState(getCmsGateway())
  if (mockState) {
    const available = new Set(
      mockState.readModels.languageGeo.languages.map((language) => language.id),
    )
    return languageIds.filter((languageId) => !available.has(languageId))
  }

  const available = new Set(
    (await (await getAdminAutomationAdapter()).languages()).map(
      (language) => language.coreId,
    ),
  )
  return languageIds.filter((id) => !available.has(id))
}
