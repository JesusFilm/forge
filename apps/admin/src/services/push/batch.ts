/**
 * KTD3, KTD11, KTD12 and KTD15 — one page of a campaign's send.
 *
 * Every database statement the page needs sits behind `PushBatchStore`, so the
 * decisions here are testable without Postgres and the store is proven once
 * against Postgres in `batch.db.test.ts`.
 *
 * The step returns a cursor and counts only. A page's phones, tokens, and copy
 * never enter the durable event log.
 */
import {
  PushCampaignStatus,
  PushDeliveryKind,
  PushDeliveryStatus,
  PushZoneStatus,
  type PrismaClient,
  type PushAudienceScope,
  type PushCampaignMode,
  type PushDestinationKind,
} from "@prisma/client"

import {
  readPushAudiencePage,
  type PushAudienceRegistration,
} from "./audience.service"
import {
  claimPushDeliveryPage,
  markPushReservedAsMissed,
  markPushUnreachable,
  moveReservedToSending,
  revertSendingToReserved,
  type PushClaimCandidate,
  type PushClaimPageResult,
  type PushSendingDelivery,
} from "./claims"
import {
  PushInputError,
  PushNotFoundError,
  PushProviderAuthError,
  PushProviderFatalError,
  PushProviderRetryableError,
} from "./errors"
import {
  PUSH_ENGLISH_LANGUAGE_SLUG,
  createPushCopyResolver,
  type PushLanguageRow,
} from "./language-resolution"
import { readPushTestDeviceRegistrations } from "./test-devices.service"
import {
  PUSH_PROVIDER_CHUNK_SIZE,
  type PushSendConfig,
  type PushTransport,
  type PushTransportMessage,
} from "./transport"
import { isPushZoneLate } from "./zone-schedule"
import { resolvePushLocalDay } from "./zone-instant"

/** The announcement payload's own version, parsed by the app (KTD9). */
export const PUSH_ANNOUNCEMENT_PAYLOAD_VERSION = 1
/** The app rejects a payload above this, so the send stays well below it. */
export const PUSH_ANNOUNCEMENT_MAX_DATA_BYTES = 1_024
/** KTD3 — a rate limit is retried in the step before the step gives up. */
export const PUSH_CHUNK_RETRY_ATTEMPTS = 3

export type PushBatchKind = "LIVE" | "TEST"

export type PushBatchInput = Readonly<{
  campaignId: string
  kind: PushBatchKind
  /** The zone group's instant as an ISO string. Null for a test send. */
  groupInstant: string | null
  cursor: string | null
}>

export type PushBatchStatus =
  | "continue"
  | "exhausted"
  | "deferred"
  | "cancelled"
  | "paused"
  | "late"

export type PushBatchCounts = Readonly<{
  audience: number
  claimed: number
  suppressed: number
  unreachable: number
  accepted: number
  failed: number
  invalid: number
  indeterminate: number
  missed: number
}>

export type PushBatchResult = Readonly<{
  status: PushBatchStatus
  nextCursor: string | null
  counts: PushBatchCounts
}>

export type PushBatchCampaign = Readonly<{
  id: string
  status: PushCampaignStatus
  mode: PushCampaignMode
  sendDate: Date | null
  localHour: number | null
  destinationKind: PushDestinationKind | null
  destinationSlug: string | null
  audienceScope: PushAudienceScope
  countries: string[]
  languageFilter: string[]
}>

export type PushCopyRow = Readonly<{
  languageSlug: string
  title: string
  body: string
}>

export type PushBatchStore = {
  readCampaign(campaignId: string): Promise<PushBatchCampaign | null>
  readCopy(campaignId: string): Promise<PushCopyRow[]>
  readLanguages(): Promise<PushLanguageRow[]>
  readZonesAt(input: { campaignId: string; instant: Date }): Promise<string[]>
  readAudiencePage(input: {
    campaign: PushBatchCampaign
    timeZones: readonly string[] | undefined
    cursor: string | null
    limit: number
    blockedCountries: readonly string[]
  }): Promise<{
    audience: PushAudienceRegistration[]
    unreachable: PushAudienceRegistration[]
    nextCursor: string | null
  }>
  readTestDevices(): Promise<PushAudienceRegistration[]>
  claimPage(input: {
    campaignId: string
    kind: PushDeliveryKind
    candidates: readonly PushClaimCandidate[]
    now: Date
  }): Promise<PushClaimPageResult>
  readReserved(input: {
    campaignId: string
    kind: PushDeliveryKind
    registrationIds: readonly string[]
  }): Promise<PushSendingDelivery[]>
  markUnreachable(input: {
    campaignId: string
    candidates: readonly PushClaimCandidate[]
    now: Date
  }): Promise<number>
  moveReservedToSending(input: {
    campaignId: string
    deliveryIds: readonly string[]
    expectedCampaignStatus: PushCampaignStatus | null
    now: Date
  }): Promise<PushSendingDelivery[]>
  revertSendingToReserved(input: {
    campaignId: string
    deliveryIds: readonly string[]
    now: Date
  }): Promise<number>
  markReservedAsMissed(input: {
    campaignId: string
    timeZones: readonly string[] | undefined
  }): Promise<number>
  startSending(input: { campaignId: string; now: Date }): Promise<boolean>
  markZones(input: {
    campaignId: string
    timeZones: readonly string[] | null
    from: readonly PushZoneStatus[]
    to: PushZoneStatus
    dispatchedAt?: Date
  }): Promise<number>
  recordAccepted(
    rows: readonly { id: string; ticketId: string }[],
  ): Promise<void>
  recordFailed(
    rows: readonly { id: string; error: string }[],
    status: PushDeliveryStatus,
  ): Promise<void>
  recordDeadTokens(
    rows: readonly {
      deliveryId: string
      registrationId: string | null
      error: string
    }[],
  ): Promise<void>
}

export type PushBatchDeps = {
  store: PushBatchStore
  transport: PushTransport
  config: PushSendConfig
  now?: () => Date
  backoffMs?: (attempt: number) => number
}

type SendRow = Readonly<{
  delivery: PushSendingDelivery
  token: string
  appLanguageSlug: string
  phoneLocale: string
}>

const EMPTY_COUNTS: PushBatchCounts = {
  audience: 0,
  claimed: 0,
  suppressed: 0,
  unreachable: 0,
  accepted: 0,
  failed: 0,
  invalid: 0,
  indeterminate: 0,
  missed: 0,
}

export function splitPushChunks<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }
  return chunks
}

/**
 * The projected-runtime guard. The first chunk always runs, so a tight budget
 * still makes progress; every later chunk needs the reserve to remain.
 */
export function shouldDeferNextPushChunk(input: {
  chunksStarted: number
  elapsedMs: number
  stepMaxDurationMs: number
  stepReserveMs: number
}): boolean {
  if (input.chunksStarted === 0) return false
  return input.stepMaxDurationMs - input.elapsedMs <= input.stepReserveMs
}

/** KTD14 — the destination and the opaque campaign identifier the app reads. */
export function buildPushAnnouncementPayload(input: {
  destinationKind: PushDestinationKind
  destinationSlug: string
  nonce: string
}): Record<string, string | number> {
  return {
    version: PUSH_ANNOUNCEMENT_PAYLOAD_VERSION,
    family: "announcement",
    kind: input.destinationKind.toLowerCase(),
    slug: input.destinationSlug,
    nonce: input.nonce,
  }
}

function defaultBackoffMs(attempt: number): number {
  return Math.min(2_000, 250 * 2 ** (attempt - 1))
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function log(event: string, fields: Record<string, string | number>): void {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ")
  console.info(`[push] event=${event} ${body}`)
}

function add(
  counts: PushBatchCounts,
  patch: Partial<PushBatchCounts>,
): PushBatchCounts {
  return { ...counts, ...patch }
}

function copyByLanguage(
  rows: readonly PushCopyRow[],
): Map<string, PushCopyRow> {
  return new Map(rows.map((row) => [row.languageSlug, row]))
}

/**
 * The local day the claim holds for a phone.
 *
 * A wave uses the campaign's own send date, so every zone in it claims the same
 * day. A send now uses the phone's day at this instant, because the campaign
 * has no send date.
 */
function localDayFor(
  campaign: PushBatchCampaign,
  registration: PushAudienceRegistration,
  now: Date,
): string {
  if (campaign.sendDate) return campaign.sendDate.toISOString().slice(0, 10)
  try {
    return resolvePushLocalDay(registration.timeZone, now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export async function runPushCampaignBatch(
  input: PushBatchInput,
  deps: PushBatchDeps,
): Promise<PushBatchResult> {
  const { store, transport, config } = deps
  const now = deps.now ?? (() => new Date())
  const backoffMs = deps.backoffMs ?? defaultBackoffMs
  const startedAt = now().getTime()
  const isLive = input.kind === "LIVE"
  const kind = isLive ? PushDeliveryKind.LIVE : PushDeliveryKind.TEST
  let counts = EMPTY_COUNTS

  const campaign = await store.readCampaign(input.campaignId)
  if (!campaign) {
    throw new PushNotFoundError(`No push campaign ${input.campaignId}`)
  }

  const instant = input.groupInstant ? new Date(input.groupInstant) : null
  const zones =
    isLive && instant
      ? await store.readZonesAt({ campaignId: input.campaignId, instant })
      : null

  // KTD12 — the flag is re-read before every page, so a flip mid-wave leaves
  // the rest of the group missed rather than sent.
  if (!config.campaignsEnabled) {
    const missed = isLive
      ? await store.markReservedAsMissed({
          campaignId: input.campaignId,
          timeZones: zones ?? undefined,
        })
      : 0
    if (isLive) {
      await store.markZones({
        campaignId: input.campaignId,
        timeZones: zones,
        from: [PushZoneStatus.PENDING, PushZoneStatus.DISPATCHING],
        to: PushZoneStatus.MISSED,
      })
      log("zone_missed", {
        campaign: input.campaignId,
        reason: "flag_off",
        instant: input.groupInstant ?? "none",
        rows: missed,
      })
    }
    return {
      status: "paused",
      nextCursor: null,
      counts: add(counts, { missed }),
    }
  }

  if (campaign.status === PushCampaignStatus.CANCELLED) {
    return { status: "cancelled", nextCursor: null, counts }
  }
  if (
    isLive &&
    campaign.status !== PushCampaignStatus.SCHEDULED &&
    campaign.status !== PushCampaignStatus.SENDING
  ) {
    return { status: "paused", nextCursor: null, counts }
  }

  // KTD11 — a late group is missed, never sent late.
  if (isLive && instant && isPushZoneLate(instant, now())) {
    const missed = await store.markReservedAsMissed({
      campaignId: input.campaignId,
      timeZones: zones ?? undefined,
    })
    await store.markZones({
      campaignId: input.campaignId,
      timeZones: zones,
      from: [PushZoneStatus.PENDING, PushZoneStatus.DISPATCHING],
      to: PushZoneStatus.MISSED,
    })
    log("zone_missed", {
      campaign: input.campaignId,
      reason: "late",
      instant: instant.toISOString(),
      rows: missed,
    })
    return { status: "late", nextCursor: null, counts: add(counts, { missed }) }
  }

  if (campaign.destinationKind == null || campaign.destinationSlug == null) {
    throw new PushInputError(
      `Campaign ${input.campaignId} names no destination to send`,
    )
  }

  const copyRows = await store.readCopy(input.campaignId)
  if (
    !copyRows.some((row) => row.languageSlug === PUSH_ENGLISH_LANGUAGE_SLUG)
  ) {
    throw new PushInputError(
      `Campaign ${input.campaignId} carries no English copy to fall back to`,
    )
  }
  const languages = await store.readLanguages()
  const resolver = createPushCopyResolver({
    copySlugs: copyRows.map((row) => row.languageSlug),
    languages,
  })
  const copy = copyByLanguage(copyRows)

  // The first page of a group opens it: the campaign moves to sending and the
  // group's zones move to dispatching. Both are conditional updates.
  if (isLive && input.cursor == null) {
    await store.startSending({ campaignId: input.campaignId, now: now() })
    await store.markZones({
      campaignId: input.campaignId,
      timeZones: zones,
      from: [PushZoneStatus.PENDING],
      to: PushZoneStatus.DISPATCHING,
    })
  }

  const page = isLive
    ? await store.readAudiencePage({
        campaign,
        timeZones: zones ?? undefined,
        cursor: input.cursor,
        limit: config.batchPageSize,
        blockedCountries: config.blockedCountries,
      })
    : {
        audience: await store.readTestDevices(),
        unreachable: [] as PushAudienceRegistration[],
        nextCursor: null,
      }
  counts = add(counts, { audience: page.audience.length })

  const candidateFor = (
    registration: PushAudienceRegistration,
  ): PushClaimCandidate | null => {
    const resolution = resolver({
      appLanguageSlug: registration.appLanguageSlug,
      phoneLocale: registration.phoneLocale,
    })
    if (!resolution) return null
    return {
      registrationId: registration.id,
      languageSlug: resolution.languageSlug,
      country: registration.country,
      timeZone: registration.timeZone,
      localDay: localDayFor(campaign, registration, now()),
    }
  }

  if (isLive && page.unreachable.length > 0) {
    const unreachable = page.unreachable.flatMap((registration) => {
      const candidate = candidateFor(registration)
      return candidate ? [candidate] : []
    })
    const written = await store.markUnreachable({
      campaignId: input.campaignId,
      candidates: unreachable,
      now: now(),
    })
    counts = add(counts, { unreachable: written })
  }

  const byRegistration = new Map(
    page.audience.map((registration) => [registration.id, registration]),
  )
  const candidates = page.audience.flatMap((registration) => {
    const candidate = candidateFor(registration)
    return candidate ? [candidate] : []
  })

  const claim = await store.claimPage({
    campaignId: input.campaignId,
    kind,
    candidates,
    now: now(),
  })
  counts = add(counts, {
    claimed: claim.claimed.length,
    suppressed: claim.suppressed.length,
  })

  // KTD3's status-driven send set. A row this campaign already claimed and
  // still holds as reserved belongs to the set, so a replay after a crash or a
  // revert sends it exactly once.
  const replayed =
    claim.alreadyClaimed.length > 0
      ? await store.readReserved({
          campaignId: input.campaignId,
          kind,
          registrationIds: claim.alreadyClaimed,
        })
      : []

  const sendRows: SendRow[] = [
    ...claim.claimed.map((delivery) => ({
      delivery,
      id: delivery.registrationId,
    })),
    ...replayed.map((delivery) => ({
      delivery,
      id: delivery.registrationId ?? "",
    })),
  ].flatMap(({ delivery, id }) => {
    const registration = byRegistration.get(id)
    if (!registration) return []
    return [
      {
        delivery,
        token: registration.expoPushToken,
        appLanguageSlug: registration.appLanguageSlug,
        phoneLocale: registration.phoneLocale,
      },
    ]
  })

  const expectedCampaignStatus = isLive ? PushCampaignStatus.SENDING : null
  let chunksStarted = 0
  let deferred = false

  for (const chunk of splitPushChunks(sendRows, PUSH_PROVIDER_CHUNK_SIZE)) {
    if (
      shouldDeferNextPushChunk({
        chunksStarted,
        elapsedMs: now().getTime() - startedAt,
        stepMaxDurationMs: config.stepMaxDurationMs,
        stepReserveMs: config.stepReserveMs,
      })
    ) {
      deferred = true
      break
    }
    chunksStarted += 1

    const moved = await store.moveReservedToSending({
      campaignId: input.campaignId,
      deliveryIds: chunk.map((row) => row.delivery.id),
      expectedCampaignStatus,
      now: now(),
    })
    if (moved.length === 0) continue

    const byDelivery = new Map(chunk.map((row) => [row.delivery.id, row]))
    const messages: PushTransportMessage[] = []
    const sending: { id: string; registrationId: string | null }[] = []
    for (const delivery of moved) {
      const row = byDelivery.get(delivery.id)
      if (!row) continue
      const words =
        copy.get(delivery.languageSlug) ?? copy.get(PUSH_ENGLISH_LANGUAGE_SLUG)!
      messages.push({
        token: row.token,
        title: words.title,
        body: words.body,
        data: buildPushAnnouncementPayload({
          destinationKind: campaign.destinationKind,
          destinationSlug: campaign.destinationSlug,
          nonce: delivery.nonce,
        }) as Record<string, string>,
      })
      sending.push({ id: delivery.id, registrationId: delivery.registrationId })
    }

    counts = await sendOneChunk({
      counts,
      messages,
      sending,
      attemptLimit: PUSH_CHUNK_RETRY_ATTEMPTS,
      backoffMs,
      campaignId: input.campaignId,
      store,
      transport,
      now,
    })
  }

  if (deferred) {
    return { status: "deferred", nextCursor: input.cursor, counts }
  }

  if (isLive && page.nextCursor == null) {
    await store.markZones({
      campaignId: input.campaignId,
      timeZones: zones,
      from: [PushZoneStatus.DISPATCHING],
      to: PushZoneStatus.DISPATCHED,
      dispatchedAt: now(),
    })
    log("zone_dispatched", {
      campaign: input.campaignId,
      instant: input.groupInstant ?? "immediate",
      zones: zones?.length ?? 0,
      accepted: counts.accepted,
      failed: counts.failed,
      invalid: counts.invalid,
      suppressed: counts.suppressed,
      unreachable: counts.unreachable,
    })
  }

  return {
    status: page.nextCursor == null ? "exhausted" : "continue",
    nextCursor: page.nextCursor,
    counts,
  }
}

/**
 * Sends one chunk and records its outcome per row.
 *
 * A retryable failure reverts the chunk and retries inside the step; when the
 * attempts run out the error leaves this function so the durable step retries
 * from the same cursor. An indeterminate failure leaves the rows at sending, so
 * the receipt step resolves them as unknown instead of resending them.
 */
async function sendOneChunk(input: {
  counts: PushBatchCounts
  messages: readonly PushTransportMessage[]
  sending: readonly { id: string; registrationId: string | null }[]
  attemptLimit: number
  backoffMs: (attempt: number) => number
  campaignId: string
  store: PushBatchStore
  transport: PushTransport
  now: () => Date
}): Promise<PushBatchCounts> {
  const { store, transport, sending, messages, campaignId } = input
  const counts = input.counts
  const deliveryIds = sending.map((row) => row.id)

  for (let attempt = 1; attempt <= input.attemptLimit; attempt += 1) {
    try {
      const outcomes = await transport.sendChunk(messages)
      const accepted: { id: string; ticketId: string }[] = []
      const failed: { id: string; error: string }[] = []
      const dead: {
        deliveryId: string
        registrationId: string | null
        error: string
      }[] = []
      for (const [index, outcome] of outcomes.entries()) {
        const row = sending[index]
        if (!row) continue
        if (outcome.kind === "accepted") {
          accepted.push({ id: row.id, ticketId: outcome.ticketId })
        } else if (outcome.kind === "dead_token") {
          dead.push({
            deliveryId: row.id,
            registrationId: row.registrationId,
            error: outcome.providerCode,
          })
        } else {
          failed.push({ id: row.id, error: outcome.providerCode })
        }
      }
      if (accepted.length > 0) await store.recordAccepted(accepted)
      if (failed.length > 0) {
        await store.recordFailed(failed, PushDeliveryStatus.FAILED)
      }
      if (dead.length > 0) await store.recordDeadTokens(dead)
      return add(counts, {
        accepted: counts.accepted + accepted.length,
        failed: counts.failed + failed.length,
        invalid: counts.invalid + dead.length,
      })
    } catch (error) {
      if (error instanceof PushProviderRetryableError) {
        await store.revertSendingToReserved({
          campaignId,
          deliveryIds,
          now: input.now(),
        })
        log("provider_retry", {
          campaign: campaignId,
          attempt,
          rows: deliveryIds.length,
          provider_code: error.providerCode,
        })
        if (attempt === input.attemptLimit) throw error
        await wait(input.backoffMs(attempt))
        // The revert put the rows back at reserved, so the next attempt has to
        // claim them again before it may send them.
        const moved = await store.moveReservedToSending({
          campaignId,
          deliveryIds,
          expectedCampaignStatus: null,
          now: input.now(),
        })
        if (moved.length === 0) return counts
        continue
      }
      if (error instanceof PushProviderAuthError) {
        await store.recordFailed(
          sending.map((row) => ({ id: row.id, error: error.providerCode })),
          PushDeliveryStatus.FAILED,
        )
        console.error(
          `[push] event=provider_auth_failed campaign=${campaignId} rows=${deliveryIds.length} provider_code=${error.providerCode}`,
        )
        throw error
      }
      if (error instanceof PushProviderFatalError) {
        await store.recordFailed(
          sending.map((row) => ({ id: row.id, error: error.providerCode })),
          PushDeliveryStatus.FAILED,
        )
        return add(counts, { failed: counts.failed + sending.length })
      }
      // Indeterminate. The rows stay at sending on purpose.
      return add(counts, {
        indeterminate: counts.indeterminate + sending.length,
      })
    }
  }
  return counts
}

/** The one implementation of the port, over Prisma. */
export function createPushBatchStore(prisma: PrismaClient): PushBatchStore {
  return {
    async readCampaign(campaignId) {
      return prisma.pushCampaign.findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          status: true,
          mode: true,
          sendDate: true,
          localHour: true,
          destinationKind: true,
          destinationSlug: true,
          audienceScope: true,
          countries: true,
          languageFilter: true,
        },
      })
    },
    async readCopy(campaignId) {
      return prisma.pushCampaignCopy.findMany({
        where: { campaignId },
        orderBy: { languageSlug: "asc" },
        select: { languageSlug: true, title: true, body: true },
      })
    },
    async readLanguages() {
      return prisma.language.findMany({
        where: { deletedAt: null, slug: { not: null }, bcp47: { not: null } },
        select: { slug: true, bcp47: true },
      })
    },
    async readZonesAt({ campaignId, instant }) {
      const rows = await prisma.pushCampaignZone.findMany({
        where: { campaignId, scheduledAt: instant },
        orderBy: { timeZone: "asc" },
        select: { timeZone: true },
      })
      return rows.map((row) => row.timeZone)
    },
    async readAudiencePage({
      campaign,
      timeZones,
      cursor,
      limit,
      blockedCountries,
    }) {
      return readPushAudiencePage(prisma, {
        campaign: {
          audienceScope: campaign.audienceScope,
          countries: campaign.countries,
          languageFilter: campaign.languageFilter,
        },
        timeZones,
        cursor,
        limit,
        blockedCountries,
      })
    },
    async readTestDevices() {
      return readPushTestDeviceRegistrations(prisma)
    },
    async claimPage(input) {
      return claimPushDeliveryPage(prisma, input)
    },
    async readReserved({ campaignId, kind, registrationIds }) {
      if (registrationIds.length === 0) return []
      const rows = await prisma.pushDelivery.findMany({
        where: {
          campaignId,
          kind,
          status: PushDeliveryStatus.RESERVED,
          registrationId: { in: [...registrationIds] },
        },
        take: registrationIds.length,
        select: {
          id: true,
          nonce: true,
          registrationId: true,
          languageSlug: true,
          country: true,
          timeZone: true,
        },
      })
      return rows
    },
    async markUnreachable(input) {
      return markPushUnreachable(prisma, input)
    },
    async moveReservedToSending(input) {
      return moveReservedToSending(prisma, input)
    },
    async revertSendingToReserved(input) {
      return revertSendingToReserved(prisma, input)
    },
    async markReservedAsMissed(input) {
      return markPushReservedAsMissed(prisma, input)
    },
    async startSending({ campaignId, now }) {
      const { count } = await prisma.pushCampaign.updateMany({
        where: { id: campaignId, status: PushCampaignStatus.SCHEDULED },
        data: { status: PushCampaignStatus.SENDING, sendingStartedAt: now },
      })
      return count === 1
    },
    async markZones({ campaignId, timeZones, from, to, dispatchedAt }) {
      const { count } = await prisma.pushCampaignZone.updateMany({
        where: {
          campaignId,
          status: { in: [...from] },
          ...(timeZones ? { timeZone: { in: [...timeZones] } } : {}),
        },
        data: { status: to, ...(dispatchedAt ? { dispatchedAt } : {}) },
      })
      return count
    },
    async recordAccepted(rows) {
      await prisma.$transaction(
        rows.map((row) =>
          prisma.pushDelivery.updateMany({
            where: { id: row.id, status: PushDeliveryStatus.SENDING },
            data: {
              status: PushDeliveryStatus.ACCEPTED,
              ticketId: row.ticketId,
            },
          }),
        ),
      )
    },
    async recordFailed(rows, status) {
      await prisma.$transaction(
        rows.map((row) =>
          prisma.pushDelivery.updateMany({
            where: {
              id: row.id,
              status: {
                in: [PushDeliveryStatus.SENDING, PushDeliveryStatus.RESERVED],
              },
            },
            data: { status, error: row.error.slice(0, 64) },
          }),
        ),
      )
    },
    async recordDeadTokens(rows) {
      // KTD1 — the delivery and the registration retire in one statement pair,
      // so a dead token never stays in a later audience.
      const registrationIds = rows.flatMap((row) =>
        row.registrationId ? [row.registrationId] : [],
      )
      await prisma.$transaction([
        ...rows.map((row) =>
          prisma.pushDelivery.updateMany({
            where: { id: row.deliveryId, status: PushDeliveryStatus.SENDING },
            data: {
              status: PushDeliveryStatus.INVALID,
              error: row.error.slice(0, 64),
            },
          }),
        ),
        ...(registrationIds.length > 0
          ? [
              prisma.pushRegistration.updateMany({
                where: { id: { in: registrationIds } },
                data: { status: "INVALID", statusChangedAt: new Date() },
              }),
            ]
          : []),
      ])
    },
  }
}
