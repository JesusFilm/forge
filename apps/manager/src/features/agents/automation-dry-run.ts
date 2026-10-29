import {
  enqueueAutomationRun,
  type AutomationRunResult,
} from "./automation-runner"
import {
  beginAutomationRunDispatch,
  claimAutomationDryRun,
  completeAutomationRun,
  createAutomationRun,
  getAutomation,
  getAutomationRun,
  getAutomationRunByIdempotencyKey,
  markAutomationRunFailedIfInFlight,
  releaseAutomationDryRunClaim,
} from "./automation-store"
import {
  isCreatableAutomationTemplate,
  type EnrichmentAutomation,
  type EnrichmentAutomationRun,
} from "./automation-contract"

export class AutomationDryRunError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "AutomationDryRunError"
  }
}
const inProgress = () =>
  new AutomationDryRunError(
    409,
    "run_in_progress",
    "Automation already has a run in progress.",
  )

function hasActiveLease(automation: EnrichmentAutomation, now: Date): boolean {
  if (!automation.leaseToken || !automation.leaseExpiresAt) return false
  return new Date(automation.leaseExpiresAt).getTime() > now.getTime()
}

function buildFailedResult(): AutomationRunResult {
  return {
    status: "failed",
    eligibleCount: 0,
    enqueuedCount: 0,
    skippedDuplicateCount: 0,
    errorCount: 1,
    jobDocumentIds: [],
    errors: ["Automation dry run failed."],
    summary: "Automation dry run failed.",
  }
}

function isTerminalRun(
  run: EnrichmentAutomationRun | null,
): run is EnrichmentAutomationRun & {
  status: "success" | "partial" | "failed" | "no_op"
} {
  return (
    run?.status === "success" ||
    run?.status === "partial" ||
    run?.status === "failed" ||
    run?.status === "no_op"
  )
}

async function completeDryRunOrMarkFailed(input: {
  runDocumentId: string
  leaseToken: string
  result: AutomationRunResult
  finishedAt: string
}) {
  try {
    return await completeAutomationRun(input)
  } catch (error) {
    const fallbackFinishedAt = new Date().toISOString()
    try {
      const persistedRun = await getAutomationRun(input.runDocumentId)
      if (isTerminalRun(persistedRun)) {
        return persistedRun
      }
    } catch {
      console.error(
        "[api/automations/dry-run] Failed to read dry run before failure fallback:",
      )
    }

    try {
      const updated = await markAutomationRunFailedIfInFlight({
        runDocumentId: input.runDocumentId,
        leaseToken: input.leaseToken,
        error: "Automation dry run persistence failed.",
        finishedAt: fallbackFinishedAt,
      })
      if (!updated) {
        const persistedRun = await getAutomationRun(input.runDocumentId)
        if (isTerminalRun(persistedRun)) {
          return persistedRun
        }
      }
    } catch {
      console.error(
        "[api/automations/dry-run] Failed to mark stranded dry run as failed:",
      )
    }
    throw error
  }
}

async function releaseDryRunClaim(input: {
  automationDocumentId: string
  leaseToken: string
}) {
  try {
    await releaseAutomationDryRunClaim(
      input.automationDocumentId,
      input.leaseToken,
    )
  } catch {
    console.error(
      "[api/automations/dry-run] Failed to release manual dry-run lease.",
    )
  }
}

function replay(
  automation: EnrichmentAutomation,
  run: EnrichmentAutomationRun,
) {
  if (
    run.runMode !== "dry_run" ||
    run.automationDocumentId !== automation.documentId
  ) {
    throw new AutomationDryRunError(
      409,
      "idempotency_conflict",
      "Request identity belongs to a different run.",
    )
  }
  if (!isTerminalRun(run)) throw inProgress()
  return { automation, run, runnerFailed: false }
}

/** Both lanes use the same read-only runner and Admin's one-time dispatch admission. */
export async function executeAutomationDryRun(
  id: string,
  idempotencyKey?: string,
) {
  let claim: { documentId: string; leaseToken: string } | null = null
  try {
    const automation = await getAutomation(id)
    if (!automation)
      throw new AutomationDryRunError(404, "not_found", "Automation not found")
    if (idempotencyKey) {
      const existing = await getAutomationRunByIdempotencyKey({
        automationDocumentId: id,
        idempotencyKey,
      })
      if (
        existing &&
        (isTerminalRun(existing) ||
          existing.runMode !== "dry_run" ||
          existing.automationDocumentId !== automation.documentId ||
          hasActiveLease(automation, new Date()))
      )
        return replay(automation, existing)
      // An interrupted request's own key may still be marked running. Let
      // claim retire it, then replay its terminal result under the new fence.
    }
    if (!isCreatableAutomationTemplate(automation.template)) {
      throw new AutomationDryRunError(
        400,
        "invalid_automation",
        "Automation template is not available for dry runs.",
      )
    }
    if (hasActiveLease(automation, new Date())) throw inProgress()
    // Claim is the recovery/admission authority, including when the recurring
    // scheduler is disabled. A broad run-history read also sees expired runs.
    claim = await claimAutomationDryRun(id)
    if (!claim) throw inProgress()
    // A competing request may have completed between the initial read and our claim.
    if (idempotencyKey) {
      const existing = await getAutomationRunByIdempotencyKey({
        automationDocumentId: id,
        idempotencyKey,
      })
      if (existing) return replay(automation, existing)
    }
    const now = new Date().toISOString()
    const run = await createAutomationRun({
      automationDocumentId: id,
      leaseToken: claim.leaseToken,
      runMode: "dry_run",
      ...(idempotencyKey ? { idempotencyKey } : {}),
      scheduledFor: now,
      startedAt: now,
    })
    // createRun can return an existing key before checking the lease. Only
    // beginDispatch establishes ownership; never settle a run on a denied fence.
    if (run.runMode !== "dry_run" || run.automationDocumentId !== id)
      throw inProgress()
    if (isTerminalRun(run) && idempotencyKey) return replay(automation, run)
    if (!(await beginAutomationRunDispatch(run.documentId, claim.leaseToken)))
      throw inProgress()
    let result: AutomationRunResult
    let runnerFailed = false
    try {
      result = await enqueueAutomationRun({
        runDocumentId: run.documentId,
        runMode: "dry_run",
        automation,
      })
    } catch {
      runnerFailed = true
      result = buildFailedResult()
    }
    const completed = await completeDryRunOrMarkFailed({
      runDocumentId: run.documentId,
      leaseToken: claim.leaseToken,
      result,
      finishedAt: new Date().toISOString(),
    })
    return {
      automation: (await getAutomation(id)) ?? automation,
      run: completed,
      runnerFailed,
    }
  } finally {
    if (claim)
      await releaseDryRunClaim({
        automationDocumentId: claim.documentId,
        leaseToken: claim.leaseToken,
      })
  }
}
