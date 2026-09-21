/**
 * KTD2 — one bounded workflow run per campaign, and the run's own lifecycle.
 *
 * The order is load-bearing: the ledger row exists before `start()`, so a run
 * that starts is always traceable, and a start that fails marks the ledger
 * failed and puts the campaign back at tested with the reason on the row.
 *
 * A test send, a wave, and a send now are all the same run. The kill switch is
 * read here as well as in every batch step, so nothing dispatches while it is
 * off.
 */
import {
  PushCampaignMode,
  PushCampaignStatus,
  PushZoneStatus,
  WorkflowRunStatus,
  type PrismaClient,
} from "@prisma/client"
import { start } from "workflow/api"

import { prisma as sharedPrisma } from "@/db/client"
import {
  attachWorkflowRuntimeRunId,
  createWorkflowRunLog,
  markWorkflowRunFailed,
  markWorkflowRunStarted,
} from "@/services/workflow-run-log.service"
import { runPushCampaign } from "@/workflows/pushCampaign"

import {
  cancelPushCampaign,
  confirmPushSendNow,
  recordPushTestSend,
  schedulePushCampaign,
} from "./campaign.service"
import { markPushReservedAsMissed } from "./claims"
import {
  PushCampaignsDisabledError,
  PushNotFoundError,
  PushRunAlreadyActiveError,
} from "./errors"
import { resolvePushSendConfig } from "./transport"
import {
  isPushZoneLate,
  readPushCampaignZoneCounts,
  resolvePushZoneGroups,
} from "./zone-schedule"
import { resolvePushLocalDay } from "./zone-instant"

export const PUSH_CAMPAIGN_WORKFLOW_KEY = "push-campaign"
export const PUSH_CAMPAIGN_WORKFLOW_NAME = "Push Campaign"
/** A wave has about forty groups; the guard stops a runaway loop, not a wave. */
export const PUSH_MAX_ZONE_GROUPS = 200
/** The plan's own bound on how many late groups one step retires at a time. */
export const PUSH_LATE_GROUP_SWEEP_LIMIT = 64

export type PushRunKind = "LIVE" | "TEST"

export type PushDispatchResult = Readonly<{
  campaignId: string
  workflowRunLogId: string
  runtimeRunId: string
  kind: PushRunKind
}>

export type PushRunInput = Readonly<{
  campaignId: string
  ledgerRunId: string
  kind: PushRunKind
}>

export type PushZoneGroupStep =
  | Readonly<{ kind: "group"; instant: string; zoneCount: number }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "ended"; status: PushCampaignStatus }>

export type PushRunCounts = Readonly<{
  accepted: number
  failed: number
  invalid: number
  suppressed: number
  unreachable: number
  missed: number
  indeterminate: number
  handedOff: number
}>

export const EMPTY_PUSH_RUN_COUNTS: PushRunCounts = {
  accepted: 0,
  failed: 0,
  invalid: 0,
  suppressed: 0,
  unreachable: 0,
  missed: 0,
  indeterminate: 0,
  handedOff: 0,
}

type Deps = {
  prisma?: PrismaClient
  startRun?: typeof start
  now?: () => Date
  campaignsEnabled?: boolean
}

function client(deps: Deps | undefined): PrismaClient {
  return deps?.prisma ?? sharedPrisma
}

function clock(deps: Deps | undefined): Date {
  return (deps?.now ?? (() => new Date()))()
}

function enabled(deps: Deps | undefined): boolean {
  return deps?.campaignsEnabled ?? resolvePushSendConfig().campaignsEnabled
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What crosses the durable step boundary. A raw Error does not survive the
 * event log, so the failure step takes a plain object it can serialize.
 */
export type PushRunFailure = Readonly<{ name: string; message: string }>

export function toPushRunFailure(error: unknown): PushRunFailure {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) }
}

// An upstream message can carry a push token, and `lastError` is shown to the
// editor. The code and the class are what an operator needs; the token is not.
const PUSH_TOKEN_PATTERN = /Expo(?:nent)?PushToken\[[^\]]*\]/g

export function redactPushErrorText(message: string): string {
  return message.replace(PUSH_TOKEN_PATTERN, "[redacted]")
}

/** KTD12 — nothing schedules, sends, or tests while the flag is off. */
function requireCampaignsEnabled(deps: Deps | undefined): void {
  if (!enabled(deps)) throw new PushCampaignsDisabledError()
}

/**
 * KTD2 — one run at a time. A ledger row still queued or running blocks a
 * second dispatch, so a double click cannot start two waves.
 */
async function refuseSecondRun(
  prisma: PrismaClient,
  campaignId: string,
): Promise<void> {
  const campaign = await prisma.pushCampaign.findUnique({
    where: { id: campaignId },
    select: { workflowRunLogId: true },
  })
  if (!campaign) throw new PushNotFoundError(`No push campaign ${campaignId}`)
  if (!campaign.workflowRunLogId) return
  const ledger = await prisma.workflowRun.findUnique({
    where: { id: campaign.workflowRunLogId },
    select: { id: true, status: true },
  })
  if (
    ledger &&
    (ledger.status === WorkflowRunStatus.QUEUED ||
      ledger.status === WorkflowRunStatus.RUNNING)
  ) {
    throw new PushRunAlreadyActiveError(ledger.id)
  }
}

/**
 * The ledger row, then the run, then the runtime id.
 *
 * A failed start marks the ledger failed and reverts a live campaign to tested
 * with the reason on the row, so the editor can fix and try again.
 */
export async function dispatchPushCampaignRun(
  input: {
    campaignId: string
    actorId: string
    kind: PushRunKind
    mode?: PushCampaignMode
    audienceCount?: number
  },
  deps?: Deps,
): Promise<PushDispatchResult> {
  const prisma = client(deps)
  const startRun = deps?.startRun ?? start
  const ledger = await createWorkflowRunLog(
    {
      workflowKey: PUSH_CAMPAIGN_WORKFLOW_KEY,
      workflowName: PUSH_CAMPAIGN_WORKFLOW_NAME,
      // An editor pressed the button, so the ledger records a manual trigger
      // with the actor id (R28).
      trigger: "manual",
      actorId: input.actorId,
      subjectType: "push-campaign",
      subjectId: input.campaignId,
      summary:
        input.kind === "TEST"
          ? "Push campaign test send started by an editor."
          : "Push campaign send started by an editor.",
      details: {
        kind: input.kind,
        mode: input.mode ?? PushCampaignMode.WAVE,
        audienceCount: input.audienceCount ?? null,
      },
    },
    prisma,
  )
  await prisma.pushCampaign.updateMany({
    where: { id: input.campaignId },
    data: { workflowRunLogId: ledger.id },
  })

  try {
    const run = await startRun(runPushCampaign, [
      {
        campaignId: input.campaignId,
        ledgerRunId: ledger.id,
        kind: input.kind,
      },
    ])
    await attachWorkflowRuntimeRunId(ledger.id, run.runId, prisma)
    console.info(
      `[push] event=run_dispatched campaign=${input.campaignId} actor=${input.actorId} kind=${input.kind.toLowerCase()} ledger=${ledger.id} run=${run.runId}`,
    )
    return {
      campaignId: input.campaignId,
      workflowRunLogId: ledger.id,
      runtimeRunId: run.runId,
      kind: input.kind,
    }
  } catch (error) {
    await markWorkflowRunFailed(ledger.id, error, prisma).catch(() => {})
    if (input.kind === "LIVE") {
      await prisma.pushCampaign.updateMany({
        where: {
          id: input.campaignId,
          status: PushCampaignStatus.SCHEDULED,
        },
        data: {
          status: PushCampaignStatus.TESTED,
          lastError: redactPushErrorText(errorText(error)).slice(0, 256),
          workflowRunLogId: null,
        },
      })
    }
    console.error(
      `[push] event=dispatch_start_failed campaign=${input.campaignId} kind=${input.kind.toLowerCase()} ledger=${ledger.id} error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
    )
    throw error
  }
}

/** R9 and R16 — schedule the wave, then start its run. */
export async function schedulePushCampaignRun(
  input: {
    campaignId: string
    actorId: string
    sendDate: string
    localHour: number
    audienceCount?: number
  },
  deps?: Deps,
): Promise<PushDispatchResult> {
  requireCampaignsEnabled(deps)
  const prisma = client(deps)
  await refuseSecondRun(prisma, input.campaignId)
  await schedulePushCampaign(prisma, input)
  return dispatchPushCampaignRun(
    {
      campaignId: input.campaignId,
      actorId: input.actorId,
      kind: "LIVE",
      mode: PushCampaignMode.WAVE,
      audienceCount: input.audienceCount,
    },
    deps,
  )
}

/** R17 — send now everywhere, after the editor's own confirmation step. */
export async function sendPushCampaignNowRun(
  input: { campaignId: string; actorId: string; audienceCount?: number },
  deps?: Deps,
): Promise<PushDispatchResult> {
  requireCampaignsEnabled(deps)
  const prisma = client(deps)
  await refuseSecondRun(prisma, input.campaignId)
  await confirmPushSendNow(prisma, input)
  return dispatchPushCampaignRun(
    {
      campaignId: input.campaignId,
      actorId: input.actorId,
      kind: "LIVE",
      mode: PushCampaignMode.IMMEDIATE,
      audienceCount: input.audienceCount,
    },
    deps,
  )
}

/** R10 — the test send that has to precede every real send. */
export async function sendPushCampaignTestRun(
  input: { campaignId: string; actorId: string },
  deps?: Deps,
): Promise<PushDispatchResult> {
  requireCampaignsEnabled(deps)
  const prisma = client(deps)
  await refuseSecondRun(prisma, input.campaignId)
  return dispatchPushCampaignRun(
    { campaignId: input.campaignId, actorId: input.actorId, kind: "TEST" },
    deps,
  )
}

/**
 * R11 — cancel. The campaign status is the gate the run re-reads, so the status
 * write is the cancel; the runtime event only wakes the run sooner.
 */
export async function cancelPushCampaignRun(
  input: { campaignId: string; actorId: string },
  deps?: Deps,
): Promise<{ zonesCancelled: number }> {
  const prisma = client(deps)
  const result = await cancelPushCampaign(prisma, input)
  const campaign = await prisma.pushCampaign.findUnique({
    where: { id: input.campaignId },
    select: { workflowRunLogId: true },
  })
  if (campaign?.workflowRunLogId) {
    const ledger = await prisma.workflowRun.findUnique({
      where: { id: campaign.workflowRunLogId },
      select: { runtimeRunId: true },
    })
    if (ledger?.runtimeRunId) {
      await requestPushRunCancel(ledger.runtimeRunId)
    }
  }
  return result
}

/**
 * Best effort. The run exits through its own status gate whatever happens here,
 * so a runtime that refuses the event only delays the exit to the next wake.
 */
export async function requestPushRunCancel(
  runtimeRunId: string,
): Promise<void> {
  try {
    const { getWorld } = await import("workflow/runtime")
    const world = getWorld()
    const run = await world.runs.get(runtimeRunId, { resolveData: "none" })
    await world.events.create(runtimeRunId, {
      eventType: "run_cancelled",
      specVersion: run.specVersion,
    } as Parameters<typeof world.events.create>[1])
  } catch (error) {
    console.warn(
      `[push] event=run_cancel_event_failed run=${runtimeRunId} error_class=${error instanceof Error ? error.constructor.name : "UnknownError"}`,
    )
  }
}

/** What the campaign page shows about the run behind a campaign. */
export async function readPushCampaignRunState(
  campaignId: string,
  deps?: Deps,
): Promise<{
  workflowRunLogId: string | null
  runtimeRunId: string | null
  ledgerStatus: WorkflowRunStatus | null
  error: string | null
} | null> {
  const prisma = client(deps)
  const campaign = await prisma.pushCampaign.findUnique({
    where: { id: campaignId },
    select: { workflowRunLogId: true, lastError: true },
  })
  if (!campaign) return null
  if (!campaign.workflowRunLogId) {
    return {
      workflowRunLogId: null,
      runtimeRunId: null,
      ledgerStatus: null,
      error: campaign.lastError,
    }
  }
  const ledger = await prisma.workflowRun.findUnique({
    where: { id: campaign.workflowRunLogId },
    select: { id: true, runtimeRunId: true, status: true, error: true },
  })
  return {
    workflowRunLogId: campaign.workflowRunLogId,
    runtimeRunId: ledger?.runtimeRunId ?? null,
    ledgerStatus: ledger?.status ?? null,
    error: ledger?.error ?? campaign.lastError,
  }
}

/** The run's first step: the ledger starts and the wave's zones are written. */
export async function startPushCampaignRun(
  input: PushRunInput & { runtimeRunId?: string },
  deps?: Deps,
): Promise<{ kind: PushRunKind; groupCount: number }> {
  const prisma = client(deps)
  await markWorkflowRunStarted(input.ledgerRunId, prisma).catch(() => {})
  if (input.runtimeRunId) {
    await attachWorkflowRuntimeRunId(
      input.ledgerRunId,
      input.runtimeRunId,
      prisma,
    ).catch(() => {})
  }
  if (input.kind === "TEST") return { kind: "TEST", groupCount: 0 }
  const groupCount = await planPushCampaignZones(
    { campaignId: input.campaignId },
    deps,
  )
  return { kind: "LIVE", groupCount }
}

/**
 * Writes one zone row per time zone the audience reports.
 *
 * A wave takes the campaign's own local hour; a send now puts every zone on one
 * instant, which is this moment. The rows are created once and skipped on a
 * replay, so the instants a replay reads are the instants the run planned.
 */
export async function planPushCampaignZones(
  input: { campaignId: string },
  deps?: Deps,
): Promise<number> {
  const prisma = client(deps)
  const now = clock(deps)
  const campaign = await prisma.pushCampaign.findUnique({
    where: { id: input.campaignId },
    select: {
      mode: true,
      sendDate: true,
      localHour: true,
      audienceScope: true,
      countries: true,
      languageFilter: true,
    },
  })
  if (!campaign) {
    throw new PushNotFoundError(`No push campaign ${input.campaignId}`)
  }
  const zoneCounts = await readPushCampaignZoneCounts(prisma, campaign)
  const countByZone = new Map(
    zoneCounts.map((row) => [row.timeZone, row.registrations]),
  )

  const groups =
    campaign.mode === PushCampaignMode.IMMEDIATE ||
    campaign.sendDate == null ||
    campaign.localHour == null
      ? [
          {
            instant: now,
            timeZones: zoneCounts.map((row) => row.timeZone),
          },
        ]
      : resolvePushZoneGroups({
          timeZones: zoneCounts.map((row) => row.timeZone),
          sendDate: campaign.sendDate.toISOString().slice(0, 10),
          localHour: campaign.localHour,
        })

  const rows = groups.flatMap((group) =>
    group.timeZones.map((timeZone) => ({
      campaignId: input.campaignId,
      timeZone,
      scheduledAt: group.instant,
      audienceCount: countByZone.get(timeZone) ?? 0,
    })),
  )
  if (rows.length > 0) {
    await prisma.pushCampaignZone.createMany({
      data: rows,
      skipDuplicates: true,
    })
  }
  return groups.filter((group) => group.timeZones.length > 0).length
}

/**
 * The next group to send, and the gates that come before it.
 *
 * A group already more than three hours past is retired here rather than slept
 * into, so a worker that was down for a day does not wake once per stale group.
 */
export async function readNextPushZoneGroup(
  input: { campaignId: string },
  deps?: Deps,
): Promise<PushZoneGroupStep> {
  const prisma = client(deps)
  const now = clock(deps)
  const campaign = await prisma.pushCampaign.findUnique({
    where: { id: input.campaignId },
    select: { status: true },
  })
  if (!campaign) {
    throw new PushNotFoundError(`No push campaign ${input.campaignId}`)
  }
  if (
    campaign.status !== PushCampaignStatus.SCHEDULED &&
    campaign.status !== PushCampaignStatus.SENDING
  ) {
    return { kind: "ended", status: campaign.status }
  }

  for (let sweep = 0; sweep < PUSH_LATE_GROUP_SWEEP_LIMIT; sweep += 1) {
    const pending = await prisma.pushCampaignZone.findMany({
      where: { campaignId: input.campaignId, status: PushZoneStatus.PENDING },
      orderBy: { scheduledAt: "asc" },
      take: 1,
      select: { scheduledAt: true },
    })
    const first = pending[0]
    if (!first) return { kind: "none" }
    const zones = await prisma.pushCampaignZone.findMany({
      where: {
        campaignId: input.campaignId,
        status: PushZoneStatus.PENDING,
        scheduledAt: first.scheduledAt,
      },
      select: { timeZone: true },
    })
    if (!isPushZoneLate(first.scheduledAt, now)) {
      return {
        kind: "group",
        instant: first.scheduledAt.toISOString(),
        zoneCount: zones.length,
      }
    }
    await prisma.pushCampaignZone.updateMany({
      where: {
        campaignId: input.campaignId,
        status: PushZoneStatus.PENDING,
        scheduledAt: first.scheduledAt,
      },
      data: { status: PushZoneStatus.MISSED },
    })
    const missed = await markPushReservedAsMissed(prisma, {
      campaignId: input.campaignId,
      timeZones: zones.map((zone) => zone.timeZone),
    })
    console.info(
      `[push] event=zone_missed campaign=${input.campaignId} reason=late instant=${first.scheduledAt.toISOString()} rows=${missed}`,
    )
  }
  return { kind: "none" }
}

/** The run's last step: the campaign's terminal status and the ledger's. */
export async function finishPushCampaignRun(
  input: PushRunInput & {
    outcome: "sent" | "cancelled" | "paused"
    counts: PushRunCounts
  },
  deps?: Deps,
): Promise<void> {
  const prisma = client(deps)
  const now = clock(deps)
  if (input.kind === "TEST") {
    if (input.counts.accepted > 0) {
      // R10 and KTD10 — a test send that reached at least one phone unlocks
      // scheduling, and the transition records the editor who asked for it.
      await recordPushTestSend(prisma, {
        campaignId: input.campaignId,
        actorId: await readRunActorId(prisma, input.ledgerRunId),
        now,
      }).catch(() => {})
    }
  } else if (input.outcome === "sent") {
    await prisma.pushCampaign.updateMany({
      where: { id: input.campaignId, status: PushCampaignStatus.SENDING },
      data: { status: PushCampaignStatus.SENT, completedAt: now },
    })
  } else if (input.outcome === "paused") {
    await prisma.pushCampaign.updateMany({
      where: {
        id: input.campaignId,
        status: {
          in: [PushCampaignStatus.SCHEDULED, PushCampaignStatus.SENDING],
        },
      },
      data: { status: PushCampaignStatus.PAUSED, completedAt: now },
    })
  }

  await prisma.workflowRun
    .update({
      where: { id: input.ledgerRunId },
      data: {
        status: WorkflowRunStatus.SUCCEEDED,
        finishedAt: now,
        summary: `Push campaign ${input.outcome}: ${input.counts.accepted} accepted, ${input.counts.handedOff} handed off, ${input.counts.failed} failed, ${input.counts.invalid} invalid, ${input.counts.missed} missed.`,
        details: { ...input.counts, outcome: input.outcome, kind: input.kind },
      },
    })
    .catch(() => {})
}

/** The editor behind a run, read from its ledger row. */
async function readRunActorId(
  prisma: PrismaClient,
  ledgerRunId: string,
): Promise<string> {
  const ledger = await prisma.workflowRun
    .findUnique({ where: { id: ledgerRunId }, select: { actorId: true } })
    .catch(() => null)
  return ledger?.actorId ?? "workflow"
}

/**
 * A run that could not finish.
 *
 * Without this the durable run fails while the ledger row stays running and
 * the campaign stays sending until the next worker restart sweeps it.
 */
export async function failPushCampaignRun(
  input: PushRunInput & { error: PushRunFailure },
  deps?: Deps,
): Promise<void> {
  const prisma = client(deps)
  const reason = redactPushErrorText(
    `${input.error.name}: ${input.error.message}`,
  ).slice(0, 256)
  await prisma.pushCampaign
    .updateMany({
      where: { id: input.campaignId },
      data: { lastError: reason },
    })
    .catch(() => {})
  await markWorkflowRunFailed(input.ledgerRunId, reason, prisma).catch(() => {})
  console.error(
    `[push] event=run_failed campaign=${input.campaignId} kind=${input.kind.toLowerCase()} error_class=${input.error.name}`,
  )
}

/** The phone's own day for a send now, used by the report and the dry run. */
export function pushCampaignLocalDay(timeZone: string, now: Date): string {
  return resolvePushLocalDay(timeZone, now)
}
