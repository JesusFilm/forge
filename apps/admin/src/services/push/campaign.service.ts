/**
 * R6 to R11 and R28 — one admin user writes a campaign, tests it, schedules it
 * or sends it now, and cancels it.
 *
 * Every transition is one conditional update whose `WHERE` carries the status
 * it expects, and it records the actor. The read before it exists to name the
 * refusal, not to gate it: the update is the gate.
 */
import {
  PushCampaignMode,
  PushCampaignStatus,
  PushDeliveryKind,
  WorkflowRunStatus,
  WorkflowRunTrigger,
  type Prisma,
  type PrismaClient,
  type PushDeliveryStatus,
  type PushDestinationKind,
} from "@prisma/client"

import {
  isPushCampaignEditable,
  PUSH_EDITABLE_STATUSES,
  refuseLostWrite,
  writePushCampaignContent,
  type PushCampaignContentWriteResult,
} from "./campaign-content.service"
import {
  cancelPendingPushZones,
  PUSH_CLAIM_HOLDING_STATUSES,
  PUSH_CLAIM_RECENT_GUARD_HOURS,
} from "./claims"
import {
  parsePushInput,
  PushScheduleInputSchema,
  type PushCampaignUpdateInput,
} from "./contracts"
import { isPushDestinationPublished } from "./destinations"
import {
  PushCampaignNotDeletableError,
  PushFrozenError,
  PushInputError,
  PushInvalidTransitionError,
  PushNotFoundError,
  PushNotTestedError,
} from "./errors"
import {
  markPushCampaignReservedMissed,
  readPushRuntimeRunLiveness,
  type PushRuntimeRunLiveness,
} from "./recovery"
import {
  ceilPushMinute,
  formatPushReceiptsClock,
  readPushTestRunState,
} from "./test-run-state"

const CANCELLABLE_STATUSES = [
  PushCampaignStatus.SCHEDULED,
  PushCampaignStatus.SENDING,
] as const
export const PUSH_TEST_OUTCOME_PAGE_LIMIT = 100
/** One statement deletes this many live rows; their opens and attributions cascade. */
export const PUSH_CAMPAIGN_DELETE_PAGE_SIZE = 5_000
/** The ledger key of the audit row that each campaign delete writes. */
export const PUSH_CAMPAIGN_DELETE_LEDGER_KEY = "push-campaign-delete"
/** A local date ends last at UTC-12, 36 hours after that date starts in UTC. */
const PUSH_LOCAL_DAY_LAST_END_HOURS = 36
const HOUR_MS = 60 * 60 * 1000

export type PushCampaignEditState = Readonly<{
  id: string
  status: PushCampaignStatus
}>

export type PushTestSendOutcome = Readonly<{
  deliveryId: string
  registrationId: string | null
  testDeviceId: string | null
  label: string | null
  status: PushDeliveryStatus
  error: string | null
  sentAt: Date
}>

type CampaignGate = {
  id: string
  status: PushCampaignStatus
  destinationKind: string | null
  destinationSlug: string | null
}

async function readGate(
  prisma: PrismaClient,
  campaignId: string,
): Promise<CampaignGate | null> {
  return prisma.pushCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      status: true,
      destinationKind: true,
      destinationSlug: true,
    },
  })
}

async function requireEditable(
  prisma: PrismaClient,
  campaignId: string,
): Promise<CampaignGate> {
  const gate = await readGate(prisma, campaignId)
  if (gate == null) {
    throw new PushInvalidTransitionError(null, PushCampaignStatus.DRAFT)
  }
  if (!isPushCampaignEditable(gate.status)) {
    throw new PushFrozenError(gate.status)
  }
  return gate
}

/** R28 — any signed-in admin user starts a campaign. */
export async function createPushCampaignDraft(
  prisma: PrismaClient,
  input: { actorId: string },
): Promise<PushCampaignEditState> {
  return prisma.pushCampaign.create({
    data: { status: PushCampaignStatus.DRAFT, lastActorId: input.actorId },
    select: { id: true, status: true },
  })
}

/**
 * R6 to R8 and R11 — the dashboard save, through the shared content write (KTD4). It
 * binds the dashboard source, so a hand save never sets the AI marker.
 */
export async function updatePushCampaign(
  prisma: PrismaClient,
  input: {
    campaignId: string
    actorId: string
    expectedContentVersion: number
    update: PushCampaignUpdateInput
  },
): Promise<PushCampaignContentWriteResult> {
  return writePushCampaignContent(prisma, {
    source: "dashboard",
    campaignId: input.campaignId,
    actorId: input.actorId,
    expectedContentVersion: input.expectedContentVersion,
    update: input.update,
  })
}

/**
 * KTD5 — pins a test send to the version the reviewer's page showed. The
 * update that writes the pin also checks that version, so a page that loaded
 * before a later change moves no row (R34).
 */
export async function pinPushTestContentVersion(
  prisma: PrismaClient,
  input: { campaignId: string; expectedContentVersion: number },
): Promise<void> {
  const { count } = await prisma.pushCampaign.updateMany({
    where: {
      id: input.campaignId,
      status: { in: [...PUSH_EDITABLE_STATUSES] },
      contentVersion: input.expectedContentVersion,
    },
    data: { lastTestContentVersion: input.expectedContentVersion },
  })
  if (count === 1) return
  await refuseLostWrite(prisma, input.campaignId)
}

/**
 * R10 and R35 — a test reached a phone, so the campaign may be scheduled or sent. KTD5 —
 * the `WHERE` needs the content version to equal the test's pin, and a missing pin moves
 * no row. The per-device outcome lives on the test delivery rows.
 */
export async function recordPushTestSend(
  prisma: PrismaClient,
  input: { campaignId: string; actorId: string; now?: Date },
): Promise<PushCampaignEditState> {
  const gate = await requireEditable(prisma, input.campaignId)
  const { count } = await prisma.pushCampaign.updateMany({
    where: {
      id: input.campaignId,
      status: { in: [...PUSH_EDITABLE_STATUSES] },
      lastTestContentVersion: { not: null },
      contentVersion: {
        equals: prisma.pushCampaign.fields.lastTestContentVersion,
      },
    },
    data: {
      status: PushCampaignStatus.TESTED,
      testSentAt: input.now ?? new Date(),
      lastActorId: input.actorId,
    },
  })
  if (count !== 1) {
    throw new PushInvalidTransitionError(gate.status, PushCampaignStatus.TESTED)
  }
  return { id: input.campaignId, status: PushCampaignStatus.TESTED }
}

/**
 * KTD10 — what the editor reads after a test send: one row per test phone,
 * newest first. A re-test writes new rows, so the newest row per phone is the
 * outcome of the last test send.
 */
export async function readPushTestSendOutcome(
  prisma: PrismaClient,
  campaignId: string,
  limit = PUSH_TEST_OUTCOME_PAGE_LIMIT,
): Promise<PushTestSendOutcome[]> {
  const rows = await prisma.pushDelivery.findMany({
    where: { campaignId, kind: PushDeliveryKind.TEST },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      status: true,
      error: true,
      createdAt: true,
      registrationId: true,
      registration: {
        select: { testDeviceId: true, testDevice: { select: { label: true } } },
      },
    },
  })
  const seen = new Set<string>()
  const outcome: PushTestSendOutcome[] = []
  for (const row of rows) {
    const key = row.registrationId ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    outcome.push({
      deliveryId: row.id,
      registrationId: row.registrationId,
      testDeviceId: row.registration?.testDeviceId ?? null,
      label: row.registration?.testDevice?.label ?? null,
      status: row.status,
      error: row.error,
      sentAt: row.createdAt,
    })
  }
  return outcome
}

function refuseUntested(gate: CampaignGate | null): void {
  if (gate == null) {
    throw new PushInvalidTransitionError(null, PushCampaignStatus.SCHEDULED)
  }
  if (gate.status === PushCampaignStatus.DRAFT) {
    throw new PushNotTestedError(gate.status)
  }
  if (gate.status !== PushCampaignStatus.TESTED) {
    throw new PushInvalidTransitionError(
      gate.status,
      PushCampaignStatus.SCHEDULED,
    )
  }
  if (gate.destinationKind == null || gate.destinationSlug == null) {
    throw new PushInputError("Name a destination before you send this campaign")
  }
}

/**
 * The picker only offers published destinations, but a test send can sit for
 * days before the schedule, so the transition checks the catalog again.
 */
async function refuseUnpublishedDestination(
  prisma: PrismaClient,
  gate: CampaignGate,
): Promise<void> {
  if (gate.destinationKind == null || gate.destinationSlug == null) return
  const published = await isPushDestinationPublished(prisma, {
    kind: gate.destinationKind as PushDestinationKind,
    slug: gate.destinationSlug,
  })
  if (!published) {
    throw new PushInputError(
      "The destination is not published. Pick a published video, series, or experience before you schedule or send.",
    )
  }
}

async function moveTestedToScheduled(
  prisma: PrismaClient,
  input: {
    campaignId: string
    actorId: string
    gate: CampaignGate
    data: Prisma.PushCampaignUpdateManyMutationInput
  },
): Promise<void> {
  const { count } = await prisma.pushCampaign.updateMany({
    where: {
      id: input.campaignId,
      status: { in: [PushCampaignStatus.TESTED] },
    },
    data: {
      ...input.data,
      status: PushCampaignStatus.SCHEDULED,
      lastActorId: input.actorId,
      lastError: null,
    },
  })
  if (count !== 1) {
    throw new PushInvalidTransitionError(
      input.gate.status,
      PushCampaignStatus.SCHEDULED,
    )
  }
}

/** R9 and R16 — a date and one local hour, sent as a wave across the zones. */
export async function schedulePushCampaign(
  prisma: PrismaClient,
  input: {
    campaignId: string
    actorId: string
    sendDate: string
    localHour: number
    audienceCount?: number
  },
): Promise<void> {
  const schedule = parsePushInput(PushScheduleInputSchema, {
    sendDate: input.sendDate,
    localHour: input.localHour,
  })
  const gate = await readGate(prisma, input.campaignId)
  refuseUntested(gate)
  await refuseUnpublishedDestination(prisma, gate as CampaignGate)
  await moveTestedToScheduled(prisma, {
    campaignId: input.campaignId,
    actorId: input.actorId,
    gate: gate as CampaignGate,
    data: {
      mode: PushCampaignMode.WAVE,
      sendDate: new Date(`${schedule.sendDate}T00:00:00.000Z`),
      localHour: schedule.localHour,
    },
  })
  logTransition("campaign_scheduled", input, PushCampaignMode.WAVE)
}

/**
 * R17 — "send now everywhere" ignores the local hour. The campaign waits at
 * scheduled until the run's first batch step moves it to sending (KTD2).
 */
export async function confirmPushSendNow(
  prisma: PrismaClient,
  input: { campaignId: string; actorId: string; audienceCount?: number },
): Promise<void> {
  const gate = await readGate(prisma, input.campaignId)
  refuseUntested(gate)
  await refuseUnpublishedDestination(prisma, gate as CampaignGate)
  await moveTestedToScheduled(prisma, {
    campaignId: input.campaignId,
    actorId: input.actorId,
    gate: gate as CampaignGate,
    data: {
      mode: PushCampaignMode.IMMEDIATE,
      sendDate: null,
      localHour: null,
    },
  })
  logTransition("campaign_send_now", input, PushCampaignMode.IMMEDIATE)
}

/**
 * R11 — cancel is allowed after sending starts; edit is not.
 *
 * A zone already dispatching is left alone so the run still reconciles the
 * receipts it is owed, but every row still only reserved is retired: a reserved
 * row sits in the daily-claim index and would hold that phone's local day.
 */
export async function cancelPushCampaign(
  prisma: PrismaClient,
  input: { campaignId: string; actorId: string },
): Promise<{ zonesCancelled: number }> {
  const gate = await readGate(prisma, input.campaignId)
  if (gate == null || !CANCELLABLE_STATUSES.includes(gate.status as never)) {
    throw new PushInvalidTransitionError(
      gate?.status ?? null,
      PushCampaignStatus.CANCELLED,
    )
  }
  const { count } = await prisma.pushCampaign.updateMany({
    where: {
      id: input.campaignId,
      status: { in: [...CANCELLABLE_STATUSES] },
    },
    data: {
      status: PushCampaignStatus.CANCELLED,
      lastActorId: input.actorId,
    },
  })
  if (count !== 1) {
    throw new PushInvalidTransitionError(
      gate.status,
      PushCampaignStatus.CANCELLED,
    )
  }
  const zonesCancelled = await cancelPendingPushZones(prisma, input.campaignId)
  const rowsMissed = await markPushCampaignReservedMissed(
    prisma,
    input.campaignId,
  )
  console.info(
    `[push] event=campaign_cancelled campaign=${input.campaignId} actor=${input.actorId} zones=${zonesCancelled} rows=${rowsMissed}`,
  )
  return { zonesCancelled }
}

/** No transition leaves these, so once the run is over nothing adds a delivery. */
const SETTLED_STATUSES = [
  PushCampaignStatus.SENT,
  PushCampaignStatus.PAUSED,
  PushCampaignStatus.CANCELLED,
] as const

type DeleteGate = {
  id: string
  status: PushCampaignStatus
  workflowRunLogId: string | null
}

type DeleteDeps = {
  now?: () => Date
  readRuntimeLiveness?: (
    runtimeRunId: string,
  ) => Promise<PushRuntimeRunLiveness>
}

/** `YYYY-MM-DD HH:MM UTC`. */
function formatDeleteAfter(at: Date): string {
  const iso = ceilPushMinute(at).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

const DELETE_AUDIT_SELECT = {
  status: true,
  mode: true,
  destinationKind: true,
  destinationSlug: true,
  audienceScope: true,
  countries: true,
  languageFilter: true,
  sendDate: true,
  localHour: true,
  sendingStartedAt: true,
  completedAt: true,
  createdAt: true,
  lastActorId: true,
  aiLastActorId: true,
  contentVersion: true,
  copies: {
    select: { languageSlug: true, title: true, body: true },
    orderBy: { languageSlug: "asc" },
  },
  zones: {
    select: { timeZone: true, status: true, audienceCount: true },
    orderBy: { timeZone: "asc" },
  },
} satisfies Prisma.PushCampaignSelect

type DeleteAuditSnapshot = Prisma.PushCampaignGetPayload<{
  select: typeof DELETE_AUDIT_SELECT
}>

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

/**
 * R28 and the plan's threat model rely on traceability, so the delete keeps one
 * ledger row with the copy that reached phones and the person who deleted it.
 */
function deleteAuditRow(
  input: { campaignId: string; actorId: string },
  snapshot: DeleteAuditSnapshot,
  deliveriesDeleted: number,
  now: Date,
): Prisma.WorkflowRunUncheckedCreateInput {
  return {
    workflowKey: PUSH_CAMPAIGN_DELETE_LEDGER_KEY,
    workflowName: "Push Campaign Delete",
    trigger: WorkflowRunTrigger.MANUAL,
    actorId: input.actorId,
    subjectType: "push-campaign",
    subjectId: input.campaignId,
    status: WorkflowRunStatus.SUCCEEDED,
    startedAt: now,
    finishedAt: now,
    summary: `Push campaign deleted by an editor: ${snapshot.status.toLowerCase()}, ${deliveriesDeleted} delivery row(s).`,
    details: {
      status: snapshot.status,
      mode: snapshot.mode,
      destinationKind: snapshot.destinationKind,
      destinationSlug: snapshot.destinationSlug,
      audienceScope: snapshot.audienceScope,
      countries: snapshot.countries,
      languageFilter: snapshot.languageFilter,
      sendDate: isoOrNull(snapshot.sendDate),
      localHour: snapshot.localHour,
      sendingStartedAt: isoOrNull(snapshot.sendingStartedAt),
      completedAt: isoOrNull(snapshot.completedAt),
      createdAt: snapshot.createdAt.toISOString(),
      lastActorId: snapshot.lastActorId,
      aiLastActorId: snapshot.aiLastActorId,
      contentVersion: snapshot.contentVersion,
      copies: snapshot.copies,
      // The zones go only with the campaign row, so they keep the planned
      // reach even when an earlier, stopped delete already paged deliveries.
      zones: snapshot.zones,
      deliveriesDeleted,
    },
  }
}

/**
 * KTD3 — the claim index and the zone guard both read live rows. A row stops
 * guarding its phone when its local day has ended in every zone and the zone
 * guard has passed. Null when no row holds a claim.
 */
async function readClaimReleaseAt(
  prisma: PrismaClient,
  campaignId: string,
): Promise<Date | null> {
  const { _max } = await prisma.pushDelivery.aggregate({
    where: {
      campaignId,
      kind: PushDeliveryKind.LIVE,
      status: { in: [...PUSH_CLAIM_HOLDING_STATUSES] },
    },
    _max: { localDay: true, createdAt: true },
  })
  if (!_max.localDay || !_max.createdAt) return null
  return new Date(
    Math.max(
      _max.localDay.getTime() + PUSH_LOCAL_DAY_LAST_END_HOURS * HOUR_MS,
      _max.createdAt.getTime() + PUSH_CLAIM_RECENT_GUARD_HOURS * HOUR_MS,
    ),
  )
}

async function refuseUndeletable(
  prisma: PrismaClient,
  gate: DeleteGate,
  now: Date,
  readRuntimeLiveness: NonNullable<DeleteDeps["readRuntimeLiveness"]>,
): Promise<void> {
  if (CANCELLABLE_STATUSES.includes(gate.status as never)) {
    throw new PushCampaignNotDeletableError(
      "This campaign is scheduled or sending. Cancel it first, then delete it.",
    )
  }
  const test = await readPushTestRunState(prisma, gate.id)
  if (test.running && now < test.receiptsUntil) {
    throw new PushCampaignNotDeletableError(
      `The last test is still collecting receipts until about ${formatPushReceiptsClock(test.receiptsUntil)} UTC. Delete the campaign after that.`,
    )
  }
  if (gate.workflowRunLogId) {
    const ledger = await prisma.workflowRun.findUnique({
      where: { id: gate.workflowRunLogId },
      select: { status: true, runtimeRunId: true },
    })
    // A run that died without its own failure step leaves its ledger row
    // running, so the runtime decides, as in the recovery sweep.
    if (
      (ledger?.status === WorkflowRunStatus.QUEUED ||
        ledger?.status === WorkflowRunStatus.RUNNING) &&
      ledger.runtimeRunId &&
      (await readRuntimeLiveness(ledger.runtimeRunId)) !== "terminal"
    ) {
      throw new PushCampaignNotDeletableError(
        "A run of this campaign may still be collecting receipts. Delete the campaign after the run finishes.",
      )
    }
  }
  const releaseAt = await readClaimReleaseAt(prisma, gate.id)
  if (releaseAt && now < releaseAt) {
    throw new PushCampaignNotDeletableError(
      `This campaign reached phones recently, and its delivery rows keep each phone to one announcement per day. Delete it after ${formatDeleteAfter(releaseAt)}.`,
    )
  }
}

/**
 * Deletes a campaign with its copy, zones, and report. Delete waits until no run
 * is in flight and no phone's day depends on the campaign's rows (KTD3).
 */
export async function deletePushCampaign(
  prisma: PrismaClient,
  input: { campaignId: string; actorId: string },
  deps: DeleteDeps = {},
): Promise<{ deliveriesDeleted: number }> {
  const gate = await prisma.pushCampaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true, status: true, workflowRunLogId: true },
  })
  if (gate === null) throw new PushNotFoundError("That campaign does not exist")
  const now = (deps.now ?? (() => new Date()))()
  await refuseUndeletable(
    prisma,
    gate,
    now,
    deps.readRuntimeLiveness ?? readPushRuntimeRunLiveness,
  )

  // A settled campaign can hold a delivery per phone, so its rows go in short
  // pages first. A delivery delete cascades to its open and attributions. A page
  // that a concurrent delete already took moves 0 rows; the next read moves on.
  let pagedDeliveries = 0
  if (SETTLED_STATUSES.includes(gate.status as never)) {
    for (;;) {
      const page = await prisma.pushDelivery.findMany({
        where: { campaignId: input.campaignId },
        select: { id: true },
        orderBy: { id: "asc" },
        take: PUSH_CAMPAIGN_DELETE_PAGE_SIZE,
      })
      if (page.length === 0) break
      const { count } = await prisma.pushDelivery.deleteMany({
        where: { id: { in: page.map(({ id }) => id) } },
      })
      pagedDeliveries += count
    }
  }

  const deliveriesDeleted = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.pushCampaign.findUnique({
      where: { id: input.campaignId },
      select: DELETE_AUDIT_SELECT,
    })
    if (snapshot === null) {
      throw new PushNotFoundError("That campaign does not exist")
    }
    // Deliveries first, as the pages do, so concurrent deletes lock rows in one
    // order. Their opens and attributions cascade; the next two catch strays.
    const { count } = await tx.pushDelivery.deleteMany({
      where: { campaignId: input.campaignId },
    })
    await tx.pushAttribution.deleteMany({
      where: { campaignId: input.campaignId },
    })
    await tx.pushOpen.deleteMany({ where: { campaignId: input.campaignId } })
    // The gate's status and run, and the snapshot's content version: a schedule,
    // a new run, or a content write changes one, and the transaction rolls back.
    const deleted = await tx.pushCampaign.deleteMany({
      where: {
        id: input.campaignId,
        status: gate.status,
        workflowRunLogId: gate.workflowRunLogId,
        contentVersion: snapshot.contentVersion,
      },
    })
    if (deleted.count !== 1) {
      // A second delete that committed first leaves no row, which is the outcome
      // this caller wanted, so it reads as not found rather than as a conflict.
      const remaining = await tx.pushCampaign.count({
        where: { id: input.campaignId },
      })
      if (remaining === 0) {
        throw new PushNotFoundError("That campaign does not exist")
      }
      throw new PushCampaignNotDeletableError(
        "This campaign changed during the delete. Load the page again, then try again.",
      )
    }
    const total = pagedDeliveries + count
    await tx.workflowRun.create({
      data: deleteAuditRow(input, snapshot, total, now),
    })
    return total
  })

  console.info(
    `[push] event=campaign_deleted campaign=${input.campaignId} actor=${input.actorId} status=${gate.status.toLowerCase()} deliveries=${deliveriesDeleted}`,
  )
  return { deliveriesDeleted }
}

function logTransition(
  event: string,
  input: { campaignId: string; actorId: string; audienceCount?: number },
  mode: PushCampaignMode,
): void {
  console.info(
    `[push] event=${event} campaign=${input.campaignId} actor=${input.actorId} mode=${mode.toLowerCase()} audience=${input.audienceCount ?? "unknown"}`,
  )
}
