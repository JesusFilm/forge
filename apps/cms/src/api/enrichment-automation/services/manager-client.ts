import type {
  AutomationRunDispatchResult,
  ClaimedAutomation,
  AutomationRunMode,
} from "./types"

export type ManagerAutomationClient = {
  enqueueAutomationRun: (input: {
    runDocumentId: string
    automation: ClaimedAutomation
  }) => Promise<AutomationRunDispatchResult>
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function normalizeReport(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value != null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return null
}

function normalizeRunMode(value: unknown): AutomationRunMode {
  return value === "dry_run" ? "dry_run" : "live"
}

function normalizeDispatchResult(
  value: unknown,
  fallbackRunMode: AutomationRunMode,
): AutomationRunDispatchResult {
  const result = value as Partial<AutomationRunDispatchResult> & {
    dryRunReport?: unknown
  }
  return {
    runMode: normalizeRunMode(result.runMode ?? fallbackRunMode),
    status: result.status ?? "failed",
    eligibleCount: result.eligibleCount ?? 0,
    enqueuedCount: result.enqueuedCount ?? 0,
    skippedDuplicateCount: result.skippedDuplicateCount ?? 0,
    errorCount: result.errorCount ?? 0,
    jobDocumentIds: Array.isArray(result.jobDocumentIds)
      ? result.jobDocumentIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    errors: Array.isArray(result.errors)
      ? result.errors.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    report: normalizeReport(result.report ?? result.dryRunReport ?? null),
    summary: result.summary ?? "Automation enqueue finished.",
  }
}

export function createManagerClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ManagerAutomationClient {
  const managerUrl = env.MANAGER_INTERNAL_URL ?? env.MANAGER_URL
  const managerApiKey = env.MANAGER_API_KEY

  if (!managerUrl || !managerApiKey) {
    throw new Error(
      "MANAGER_INTERNAL_URL (or MANAGER_URL) and MANAGER_API_KEY are required for enrichment automations",
    )
  }

  return {
    async enqueueAutomationRun({ runDocumentId, automation }) {
      const response = await fetch(
        `${trimTrailingSlash(managerUrl)}/api/automations/runs/${encodeURIComponent(runDocumentId)}/enqueue`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${managerApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            automation: {
              ...automation,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      )

      if (!response.ok) {
        const bodyText = (await response.text()).slice(0, 500)
        throw new Error(
          `Manager enqueue returned ${response.status}: ${bodyText}`,
        )
      }

      return normalizeDispatchResult(
        (await response.json()) as unknown,
        automation.runMode,
      )
    },
  }
}
