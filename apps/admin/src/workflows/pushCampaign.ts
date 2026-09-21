/**
 * KTD2 — one bounded durable run per push campaign.
 *
 * The run sleeps to each instant group in order, sends it in bounded pages, and
 * reconciles receipts for the groups already dispatched. A test send is the same
 * run with the test-device list as its audience and no zone at all.
 *
 * Every step call at workflow scope is sequential. Production rejects the same
 * step called from a parallel fanout, so the parallelism lives inside the
 * transport's own chunk concurrency, never here.
 */
import { RetryableError, getWorkflowMetadata, sleep } from "workflow"

import type { PushBatchResult } from "@/services/push/batch"
import type {
  PushRunCounts,
  PushRunFailure,
  PushRunKind,
  PushZoneGroupStep,
} from "@/services/push/dispatch"
import type { PushReceiptResult } from "@/services/push/receipts"

/** The wait before the run's last reconcile, so late receipts are read once. */
export const PUSH_FINAL_RECONCILE_DELAY_MS = 15 * 60_000
/** A page loop guard. A 5000-phone page means 200 pages per million phones. */
export const PUSH_MAX_PAGES_PER_GROUP = 2_000
/** A wave has about forty groups; this only stops a runaway loop. */
export const PUSH_MAX_GROUPS_PER_RUN = 200

export type PushCampaignRunInput = {
  campaignId: string
  ledgerRunId: string
  kind: PushRunKind
}

export type PushCampaignRunReport = {
  campaignId: string
  kind: PushRunKind
  outcome: "sent" | "cancelled" | "paused"
  groupsDispatched: number
  counts: PushRunCounts
}

const EMPTY: PushRunCounts = {
  accepted: 0,
  failed: 0,
  invalid: 0,
  suppressed: 0,
  unreachable: 0,
  missed: 0,
  indeterminate: 0,
  handedOff: 0,
}

/**
 * The failure the event log can carry. It is built here rather than imported
 * from the service, so the workflow module keeps its import graph free of
 * Prisma.
 */
function runFailure(error: unknown): PushRunFailure {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) }
}

function withBatch(
  counts: PushRunCounts,
  batch: PushBatchResult,
): PushRunCounts {
  return {
    ...counts,
    accepted: counts.accepted + batch.counts.accepted,
    failed: counts.failed + batch.counts.failed,
    invalid: counts.invalid + batch.counts.invalid,
    suppressed: counts.suppressed + batch.counts.suppressed,
    unreachable: counts.unreachable + batch.counts.unreachable,
    missed: counts.missed + batch.counts.missed,
    indeterminate: counts.indeterminate + batch.counts.indeterminate,
  }
}

function withReceipts(
  counts: PushRunCounts,
  receipts: PushReceiptResult,
): PushRunCounts {
  return {
    ...counts,
    handedOff: counts.handedOff + receipts.counts.handedOff,
    failed: counts.failed + receipts.counts.failed,
    invalid: counts.invalid + receipts.counts.invalid,
  }
}

export async function runPushCampaign(
  input: PushCampaignRunInput,
): Promise<PushCampaignRunReport> {
  "use workflow"

  await stepStartPushCampaignRun(input)

  let counts = EMPTY
  let outcome: "sent" | "cancelled" | "paused" = "sent"
  let groupsDispatched = 0

  try {
    if (input.kind === "TEST") {
      let cursor: string | null = null
      for (let page = 0; page < PUSH_MAX_PAGES_PER_GROUP; page += 1) {
        const batch: PushBatchResult = await stepRunPushCampaignBatch({
          campaignId: input.campaignId,
          kind: "TEST",
          groupInstant: null,
          cursor,
        })
        counts = withBatch(counts, batch)
        if (batch.status === "continue" || batch.status === "deferred") {
          cursor = batch.nextCursor
          continue
        }
        if (batch.status === "cancelled") outcome = "cancelled"
        if (batch.status === "paused") outcome = "paused"
        break
      }
    } else {
      for (let group = 0; group < PUSH_MAX_GROUPS_PER_RUN; group += 1) {
        const next: PushZoneGroupStep = await stepNextPushZoneGroup(input)
        if (next.kind === "none") break
        if (next.kind === "ended") {
          outcome = next.status === "CANCELLED" ? "cancelled" : "paused"
          break
        }

        await sleep(new Date(next.instant))

        let cursor: string | null = null
        let ended: "cancelled" | "paused" | null = null
        for (let page = 0; page < PUSH_MAX_PAGES_PER_GROUP; page += 1) {
          const batch: PushBatchResult = await stepRunPushCampaignBatch({
            campaignId: input.campaignId,
            kind: "LIVE",
            groupInstant: next.instant,
            cursor,
          })
          counts = withBatch(counts, batch)
          if (batch.status === "continue" || batch.status === "deferred") {
            cursor = batch.nextCursor
            continue
          }
          if (batch.status === "cancelled") ended = "cancelled"
          if (batch.status === "paused") ended = "paused"
          break
        }
        groupsDispatched += 1

        // The receipt step runs for every group already dispatched, including on
        // the cancel path, so the rows a cancelled wave already sent still resolve.
        counts = withReceipts(
          counts,
          await stepReconcilePushCampaignReceipts({
            campaignId: input.campaignId,
            minAgeMs: null,
          }),
        )

        if (ended) {
          outcome = ended
          break
        }
      }
    }

    await sleep(PUSH_FINAL_RECONCILE_DELAY_MS)
    counts = withReceipts(
      counts,
      await stepReconcilePushCampaignReceipts({
        campaignId: input.campaignId,
        minAgeMs: 0,
      }),
    )

    await stepFinishPushCampaignRun({ ...input, outcome, counts })
  } catch (error) {
    // The run is over either way. Recording it here means the ledger and the
    // campaign say so now, rather than at the next worker restart's sweep.
    await stepFailPushCampaignRun({ ...input, error: runFailure(error) })
    throw error
  }
  return {
    campaignId: input.campaignId,
    kind: input.kind,
    outcome,
    groupsDispatched,
    counts,
  }
}

export async function stepStartPushCampaignRun(
  input: PushCampaignRunInput,
): Promise<{ kind: PushRunKind; groupCount: number }> {
  "use step"
  const { startPushCampaignRun } = await import("@/services/push/dispatch")
  return startPushCampaignRun({
    ...input,
    runtimeRunId: getWorkflowMetadata().workflowRunId,
  })
}

export async function stepNextPushZoneGroup(
  input: PushCampaignRunInput,
): Promise<PushZoneGroupStep> {
  "use step"
  const { readNextPushZoneGroup } = await import("@/services/push/dispatch")
  return readNextPushZoneGroup({ campaignId: input.campaignId })
}

/**
 * One page of the send. The step returns a cursor and counts only, so the
 * durable event log never carries a phone, a token, or a line of copy.
 *
 * A retryable provider failure becomes a `RetryableError`, so the runtime calls
 * this step again from the same cursor. The reverted rows are still reserved, so
 * that replay sends them exactly once.
 */
export async function stepRunPushCampaignBatch(input: {
  campaignId: string
  kind: PushRunKind
  groupInstant: string | null
  cursor: string | null
}): Promise<PushBatchResult> {
  "use step"
  const { prisma } = await import("@/db/client")
  const { createPushBatchStore, runPushCampaignBatch } =
    await import("@/services/push/batch")
  const { createPushTransport, resolvePushSendConfig } =
    await import("@/services/push/transport")
  const { PushProviderRetryableError } = await import("@/services/push/errors")

  const config = resolvePushSendConfig()
  try {
    return await runPushCampaignBatch(input, {
      store: createPushBatchStore(prisma),
      transport: createPushTransport({ config }),
      config,
    })
  } catch (error) {
    if (error instanceof PushProviderRetryableError) {
      throw new RetryableError("The push provider refused this chunk", {
        retryAfter: "1m",
      })
    }
    throw error
  }
}

stepRunPushCampaignBatch.maxRetries = 5

export async function stepReconcilePushCampaignReceipts(input: {
  campaignId: string
  minAgeMs: number | null
}): Promise<PushReceiptResult> {
  "use step"
  const { prisma } = await import("@/db/client")
  const { createPushReceiptStore, reconcilePushCampaignReceipts } =
    await import("@/services/push/receipts")
  const { createPushTransport, resolvePushSendConfig } =
    await import("@/services/push/transport")
  const { PushProviderRetryableError } = await import("@/services/push/errors")

  const config = resolvePushSendConfig()
  try {
    return await reconcilePushCampaignReceipts(
      {
        campaignId: input.campaignId,
        minAgeMs: input.minAgeMs ?? undefined,
      },
      {
        store: createPushReceiptStore(prisma),
        transport: createPushTransport({ config }),
        config,
      },
    )
  } catch (error) {
    if (error instanceof PushProviderRetryableError) {
      throw new RetryableError("The push provider refused this receipt page", {
        retryAfter: "1m",
      })
    }
    throw error
  }
}

stepReconcilePushCampaignReceipts.maxRetries = 5

export async function stepFailPushCampaignRun(
  input: PushCampaignRunInput & { error: PushRunFailure },
): Promise<void> {
  "use step"
  const { failPushCampaignRun } = await import("@/services/push/dispatch")
  await failPushCampaignRun(input)
}

export async function stepFinishPushCampaignRun(
  input: PushCampaignRunInput & {
    outcome: "sent" | "cancelled" | "paused"
    counts: PushRunCounts
  },
): Promise<void> {
  "use step"
  const { finishPushCampaignRun } = await import("@/services/push/dispatch")
  await finishPushCampaignRun(input)
}
