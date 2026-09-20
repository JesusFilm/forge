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
  type Prisma,
  type PrismaClient,
  type PushDeliveryStatus,
} from "@prisma/client"
import { z } from "zod"

import { cancelPendingPushZones } from "./claims"
import {
  PushCampaignUpdateInputSchema,
  PushScheduleInputSchema,
  type PushCampaignUpdateInput,
} from "./contracts"
import {
  PushFrozenError,
  PushInputError,
  PushInvalidTransitionError,
  PushNotTestedError,
} from "./errors"

/** The editor may still change copy, destination, and audience here. */
const EDITABLE_STATUSES = [
  PushCampaignStatus.DRAFT,
  PushCampaignStatus.TESTED,
] as const
const CANCELLABLE_STATUSES = [
  PushCampaignStatus.SCHEDULED,
  PushCampaignStatus.SENDING,
] as const
export const PUSH_TEST_OUTCOME_PAGE_LIMIT = 100

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

function asInputError(error: unknown): never {
  if (error instanceof z.ZodError) {
    throw new PushInputError(
      error.issues.map((issue) => issue.message).join("; "),
    )
  }
  throw error
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error) {
    asInputError(error)
  }
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
  if (!EDITABLE_STATUSES.includes(gate.status as never)) {
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
 * R6 to R8 and R11 — saves the campaign's words, destination, and audience.
 *
 * A tested campaign returns to draft, because the copy it was tested with is
 * no longer the copy it would send.
 */
export async function updatePushCampaign(
  prisma: PrismaClient,
  input: {
    campaignId: string
    actorId: string
    update: PushCampaignUpdateInput
  },
): Promise<PushCampaignEditState> {
  const update = parse(PushCampaignUpdateInputSchema, input.update)
  const gate = await requireEditable(prisma, input.campaignId)

  const data: Prisma.PushCampaignUpdateManyMutationInput = {
    status: PushCampaignStatus.DRAFT,
    lastActorId: input.actorId,
    ...(update.destination
      ? {
          destinationKind: update.destination.kind,
          destinationSlug: update.destination.slug,
        }
      : {}),
    ...(update.audience
      ? {
          audienceScope: update.audience.scope,
          countries: update.audience.countries,
          languageFilter: update.audience.languageFilter,
        }
      : {}),
  }

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.pushCampaign.updateMany({
      where: { id: input.campaignId, status: { in: [...EDITABLE_STATUSES] } },
      data,
    })
    if (count !== 1) {
      throw new PushInvalidTransitionError(
        gate.status,
        PushCampaignStatus.DRAFT,
      )
    }
    if (update.copies) {
      await tx.pushCampaignCopy.deleteMany({
        where: { campaignId: input.campaignId },
      })
      await tx.pushCampaignCopy.createMany({
        data: update.copies.map((copy) => ({
          ...copy,
          campaignId: input.campaignId,
        })),
      })
    }
    return { id: input.campaignId, status: PushCampaignStatus.DRAFT }
  })
}

/**
 * R10 — a test send reached at least one phone, so the campaign may now be
 * scheduled or sent. The per-device outcome lives on the test delivery rows.
 */
export async function recordPushTestSend(
  prisma: PrismaClient,
  input: { campaignId: string; actorId: string; now?: Date },
): Promise<PushCampaignEditState> {
  const gate = await requireEditable(prisma, input.campaignId)
  const { count } = await prisma.pushCampaign.updateMany({
    where: { id: input.campaignId, status: { in: [...EDITABLE_STATUSES] } },
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
  const schedule = parse(PushScheduleInputSchema, {
    sendDate: input.sendDate,
    localHour: input.localHour,
  })
  const gate = await readGate(prisma, input.campaignId)
  refuseUntested(gate)
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

/** R11 — cancel is allowed after sending starts; edit is not. */
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
  console.info(
    `[push] event=campaign_cancelled campaign=${input.campaignId} actor=${input.actorId} zones=${zonesCancelled}`,
  )
  return { zonesCancelled }
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
