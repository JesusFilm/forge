/**
 * KTD2's recovery sweep, run once at worker start.
 *
 * A worker restart is normal: the runtime re-enqueues its own active runs, so a
 * sleeping campaign run is still alive afterwards. Only a campaign whose run
 * the runtime has finished, failed, cancelled, or never received is orphaned.
 * When the runtime cannot be read at all the campaign is left alone, because
 * marking a live wave missed is far worse than waiting for the next boot.
 */
import {
  PushCampaignStatus,
  PushDeliveryKind,
  PushDeliveryStatus,
  PushZoneStatus,
  type PrismaClient,
} from "@prisma/client"

/** The sweep is bounded: a fleet never has more than a few live campaigns. */
export const PUSH_RECOVERY_CAMPAIGN_LIMIT = 50
const RUNTIME_STATUS_LOOKUP_DEADLINE_MS = 1_000

export type PushRuntimeRunLiveness = "alive" | "terminal" | "unknown"

export type PushRecoveryCampaign = Readonly<{
  id: string
  status: PushCampaignStatus
  workflowRunLogId: string | null
  runtimeRunId: string | null
}>

export type PushRecoveryResult = Readonly<{
  campaignsInspected: number
  campaignsSwept: number
  zonesMissed: number
  deliveriesMissed: number
  failures: number
}>

export type PushRecoveryStore = {
  readActiveCampaigns(limit: number): Promise<PushRecoveryCampaign[]>
  markZonesMissed(campaignId: string): Promise<number>
  markReservedMissed(campaignId: string): Promise<number>
  pauseCampaign(input: { campaignId: string; reason: string }): Promise<boolean>
}

export type PushRecoveryDeps = {
  store: PushRecoveryStore
  readRuntimeStatus: (runtimeRunId: string) => Promise<PushRuntimeRunLiveness>
  now?: () => Date
  limit?: number
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "UnknownError"
}

export async function sweepOrphanedPushCampaigns(
  deps: PushRecoveryDeps,
): Promise<PushRecoveryResult> {
  const limit = deps.limit ?? PUSH_RECOVERY_CAMPAIGN_LIMIT
  const campaigns = await deps.store.readActiveCampaigns(limit)
  let campaignsSwept = 0
  let zonesMissed = 0
  let deliveriesMissed = 0
  let failures = 0

  for (const campaign of campaigns) {
    // No ledger row and no runtime id means nothing will ever run this
    // campaign, so it is orphaned without asking the runtime.
    const liveness: PushRuntimeRunLiveness = campaign.runtimeRunId
      ? await deps.readRuntimeStatus(campaign.runtimeRunId)
      : "terminal"
    if (liveness !== "terminal") continue

    try {
      zonesMissed += await deps.store.markZonesMissed(campaign.id)
      deliveriesMissed += await deps.store.markReservedMissed(campaign.id)
      await deps.store.pauseCampaign({
        campaignId: campaign.id,
        reason: "run_not_alive",
      })
      campaignsSwept += 1
      console.info(
        `[push] event=zone_missed campaign=${campaign.id} reason=run_not_alive zones=${zonesMissed} rows=${deliveriesMissed}`,
      )
    } catch (error) {
      failures += 1
      // The message may embed a push token, so only the class is logged.
      console.warn(
        `[push] event=recovery_sweep_failure campaign=${campaign.id} error_class=${errorClass(error)}`,
      )
    }
  }

  return {
    campaignsInspected: campaigns.length,
    campaignsSwept,
    zonesMissed,
    deliveriesMissed,
    failures,
  }
}

/** The one implementation of the port, over Prisma. */
export function createPushRecoveryStore(
  prisma: PrismaClient,
): PushRecoveryStore {
  return {
    async readActiveCampaigns(limit) {
      const rows = await prisma.pushCampaign.findMany({
        where: {
          status: {
            in: [PushCampaignStatus.SCHEDULED, PushCampaignStatus.SENDING],
          },
        },
        orderBy: { updatedAt: "asc" },
        take: limit,
        select: {
          id: true,
          status: true,
          workflowRunLogId: true,
        },
      })
      const ledgerIds = rows.flatMap((row) =>
        row.workflowRunLogId ? [row.workflowRunLogId] : [],
      )
      const ledgers =
        ledgerIds.length > 0
          ? await prisma.workflowRun.findMany({
              where: { id: { in: ledgerIds } },
              select: { id: true, runtimeRunId: true },
            })
          : []
      const runtimeById = new Map(
        ledgers.map((ledger) => [ledger.id, ledger.runtimeRunId]),
      )
      return rows.map((row) => ({
        id: row.id,
        status: row.status,
        workflowRunLogId: row.workflowRunLogId,
        runtimeRunId: row.workflowRunLogId
          ? (runtimeById.get(row.workflowRunLogId) ?? null)
          : null,
      }))
    },
    async markZonesMissed(campaignId) {
      const { count } = await prisma.pushCampaignZone.updateMany({
        where: {
          campaignId,
          status: { in: [PushZoneStatus.PENDING, PushZoneStatus.DISPATCHING] },
        },
        data: { status: PushZoneStatus.MISSED },
      })
      return count
    },
    async markReservedMissed(campaignId) {
      const { count } = await prisma.pushDelivery.updateMany({
        where: {
          campaignId,
          kind: PushDeliveryKind.LIVE,
          status: PushDeliveryStatus.RESERVED,
        },
        data: { status: PushDeliveryStatus.MISSED },
      })
      return count
    },
    async pauseCampaign({ campaignId, reason }) {
      const { count } = await prisma.pushCampaign.updateMany({
        where: {
          id: campaignId,
          status: {
            in: [PushCampaignStatus.SCHEDULED, PushCampaignStatus.SENDING],
          },
        },
        data: {
          status: PushCampaignStatus.PAUSED,
          lastError: reason,
          completedAt: new Date(),
        },
      })
      return count === 1
    },
  }
}

/**
 * The runtime's own view of a run. A lookup that times out or throws answers
 * `unknown`, which preserves the campaign.
 */
export async function readPushRuntimeRunLiveness(
  runtimeRunId: string,
): Promise<PushRuntimeRunLiveness> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { getWorld } = await import("workflow/runtime")
    const lookup = getWorld().runs.get(runtimeRunId, { resolveData: "none" })
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("workflow runtime lookup timed out")),
        RUNTIME_STATUS_LOOKUP_DEADLINE_MS,
      )
    })
    lookup.catch(() => {})
    const run = await Promise.race([lookup, deadline])
    return run.status === "pending" || run.status === "running"
      ? "alive"
      : "terminal"
  } catch {
    return "unknown"
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Called once at worker start. It never throws into boot. */
export async function ensurePushCampaignRecovery(): Promise<PushRecoveryResult | null> {
  try {
    const { prisma } = await import("@/db/client")
    return await sweepOrphanedPushCampaigns({
      store: createPushRecoveryStore(prisma),
      readRuntimeStatus: readPushRuntimeRunLiveness,
    })
  } catch (error) {
    console.warn(
      `[push] event=recovery_start_failure error_class=${errorClass(error)}`,
    )
    return null
  }
}
