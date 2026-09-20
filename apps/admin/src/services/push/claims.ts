/**
 * KTD3 — every claim is one statement, one statement per page, and the send
 * set is status-driven.
 *
 * The daily claim is a multi-row `INSERT ... ON CONFLICT DO NOTHING` with no
 * conflict target, so both partial unique indexes migration 0099 declares act
 * as arbiters. `RETURNING` names the rows that won; the phones absent from it
 * lost the day and get a suppressed row. Every status move is an update whose
 * `WHERE` carries the status it expects, and the affected count is the race
 * discriminator.
 */
import { randomBytes, randomUUID } from "node:crypto"

import {
  Prisma,
  PushCampaignStatus,
  PushDeliveryKind,
  PushDeliveryStatus,
  PushZoneStatus,
  type PrismaClient,
} from "@prisma/client"

import { toPgArray } from "@/db/pgvector"

import { PushInputError } from "./errors"

/** KTD14 — the campaign identifier in a payload is 32 random bytes. */
const PUSH_NONCE_BYTES = 32
/** KTD3 — a phone served this recently keeps its day when its zone moved. */
export const PUSH_CLAIM_RECENT_GUARD_HOURS = 20
/** One statement per page, and `unnest` keeps the parameter count flat. */
export const PUSH_CLAIM_MAX_CANDIDATES = 20_000
export const PUSH_MISSED_PAGE_LIMIT = 5_000

/** The statuses under which the phone may have been reached (KTD3). */
export const PUSH_CLAIM_HOLDING_STATUSES = [
  PushDeliveryStatus.RESERVED,
  PushDeliveryStatus.SENDING,
  PushDeliveryStatus.ACCEPTED,
  PushDeliveryStatus.HANDED_OFF,
  PushDeliveryStatus.UNKNOWN,
] as const

const HOUR_MS = 60 * 60 * 1000

export type PushClaimCandidate = Readonly<{
  registrationId: string
  /** The copy language KTD5 resolved for this phone. */
  languageSlug: string
  country: string | null
  timeZone: string
  /** The campaign's send date, or the phone's own day for a send now. */
  localDay: string
}>

export type PushClaimedDelivery = Readonly<{
  id: string
  nonce: string
  registrationId: string
  languageSlug: string
  country: string | null
  timeZone: string
  localDay: string
}>

export type PushClaimSuppressionReason = "daily_claim" | "zone_guard"

export type PushClaimSuppression = Readonly<{
  registrationId: string
  reason: PushClaimSuppressionReason
}>

export type PushClaimPageResult = Readonly<{
  claimed: PushClaimedDelivery[]
  suppressed: PushClaimSuppression[]
  /** Phones this campaign had already claimed, which a replay reads again. */
  alreadyClaimed: string[]
}>

export type PushSendingDelivery = Readonly<{
  id: string
  nonce: string
  registrationId: string | null
  languageSlug: string
  country: string | null
  timeZone: string
}>

type ClaimRow = { id: string; nonce: string; registration_id: string }

type SendingRow = {
  id: string
  nonce: string
  registration_id: string | null
  language_slug: string
  country: string | null
  time_zone: string
}

/** KTD14 — base64url, following the experience preview-token precedent. */
export function nextPushDeliveryNonce(): string {
  return randomBytes(PUSH_NONCE_BYTES).toString("base64url")
}

function firstPerRegistration(
  candidates: readonly PushClaimCandidate[],
): PushClaimCandidate[] {
  const seen = new Set<string>()
  const kept: PushClaimCandidate[] = []
  for (const row of candidates) {
    if (seen.has(row.registrationId)) continue
    seen.add(row.registrationId)
    kept.push(row)
  }
  return kept
}

type ClaimInsertRow = PushClaimCandidate &
  Readonly<{ id: string; nonce: string }>

function insertStatement(input: {
  campaignId: string
  kind: PushDeliveryKind
  status: PushDeliveryStatus
  now: Date
  rows: readonly ClaimInsertRow[]
  errors?: readonly string[]
}): Prisma.Sql {
  const { rows, errors } = input
  const column = <T>(read: (row: ClaimInsertRow) => T) => rows.map(read)
  return Prisma.sql`
    INSERT INTO push_delivery (
      id, nonce, kind, campaign_id, registration_id, local_day,
      language_slug, country, time_zone, status, error, created_at, updated_at
    )
    SELECT
      c.id, c.nonce, ${input.kind.toLowerCase()}::"PushDeliveryKind",
      ${input.campaignId}, c.registration_id, c.local_day::date,
      c.language_slug, c.country, c.time_zone,
      ${input.status.toLowerCase()}::"PushDeliveryStatus", c.error,
      ${input.now}, ${input.now}
    FROM unnest(
      ${toPgArray(column((row) => row.id))}::text[],
      ${toPgArray(column((row) => row.nonce))}::text[],
      ${toPgArray(column((row) => row.registrationId))}::text[],
      ${toPgArray(column((row) => row.localDay))}::text[],
      ${toPgArray(column((row) => row.languageSlug))}::text[],
      ${toPgArray(column((row) => row.country))}::text[],
      ${toPgArray(column((row) => row.timeZone))}::text[],
      ${toPgArray(errors ? [...errors] : rows.map(() => null))}::text[]
    ) AS c(
      id, nonce, registration_id, local_day,
      language_slug, country, time_zone, error
    )
    ON CONFLICT DO NOTHING
    RETURNING id, nonce, registration_id
  `
}

/**
 * Claims one page of phones for a campaign.
 *
 * A live claim holds the phone's local day; a test claim skips the daily claim
 * altogether (KTD2), so a test send never blocks the live send to the same
 * phone. The served-recently guard is best effort — the index is the promise.
 */
export async function claimPushDeliveryPage(
  prisma: PrismaClient,
  input: {
    campaignId: string
    kind: PushDeliveryKind
    candidates: readonly PushClaimCandidate[]
    now?: Date
  },
): Promise<PushClaimPageResult> {
  const { campaignId, kind } = input
  const now = input.now ?? new Date()
  if (input.candidates.length > PUSH_CLAIM_MAX_CANDIDATES) {
    throw new PushInputError(
      `A claim page carries at most ${PUSH_CLAIM_MAX_CANDIDATES} phones`,
    )
  }
  const candidates = firstPerRegistration(input.candidates)
  if (candidates.length === 0) {
    return { claimed: [], suppressed: [], alreadyClaimed: [] }
  }

  const guarded =
    kind === PushDeliveryKind.LIVE
      ? await readZoneGuard(prisma, { campaignId, candidates, now })
      : new Set<string>()
  const attempted = candidates.filter((row) => !guarded.has(row.registrationId))

  const prepared = attempted.map((row) => ({
    ...row,
    id: randomUUID(),
    nonce: nextPushDeliveryNonce(),
  }))
  const won =
    prepared.length === 0
      ? []
      : await prisma.$queryRaw<ClaimRow[]>(
          insertStatement({
            campaignId,
            kind,
            status: PushDeliveryStatus.RESERVED,
            now,
            rows: prepared,
          }),
        )

  const wonIds = new Set(won.map((row) => row.registration_id))
  const claimed = prepared
    .filter((row) => wonIds.has(row.registrationId))
    .map(
      (row): PushClaimedDelivery => ({
        id: row.id,
        nonce: row.nonce,
        registrationId: row.registrationId,
        languageSlug: row.languageSlug,
        country: row.country,
        timeZone: row.timeZone,
        localDay: row.localDay,
      }),
    )

  if (kind !== PushDeliveryKind.LIVE) {
    return { claimed, suppressed: [], alreadyClaimed: [] }
  }

  const lost = attempted.filter((row) => !wonIds.has(row.registrationId))
  const alreadyClaimed = await readOwnRows(prisma, {
    campaignId,
    registrationIds: lost.map((row) => row.registrationId),
  })
  const suppressed: PushClaimSuppression[] = [
    ...candidates
      .filter((row) => guarded.has(row.registrationId))
      .map(
        (row): PushClaimSuppression => ({
          registrationId: row.registrationId,
          reason: "zone_guard",
        }),
      ),
    ...lost
      .filter((row) => !alreadyClaimed.has(row.registrationId))
      .map(
        (row): PushClaimSuppression => ({
          registrationId: row.registrationId,
          reason: "daily_claim",
        }),
      ),
  ]
  await writeSuppressed(prisma, {
    campaignId,
    now,
    candidates,
    suppressed,
  })

  return { claimed, suppressed, alreadyClaimed: [...alreadyClaimed] }
}

/**
 * Phones a different campaign served inside the guard window from another
 * zone. A same-zone pair is left alone, so an evening and a next-morning
 * campaign both deliver.
 */
async function readZoneGuard(
  prisma: PrismaClient,
  input: {
    campaignId: string
    candidates: readonly PushClaimCandidate[]
    now: Date
  },
): Promise<Set<string>> {
  const zoneByRegistration = new Map(
    input.candidates.map((row) => [row.registrationId, row.timeZone]),
  )
  const recent = await prisma.pushDelivery.findMany({
    where: {
      kind: PushDeliveryKind.LIVE,
      campaignId: { not: input.campaignId },
      registrationId: { in: [...zoneByRegistration.keys()] },
      status: { in: [...PUSH_CLAIM_HOLDING_STATUSES] },
      createdAt: {
        gte: new Date(
          input.now.getTime() - PUSH_CLAIM_RECENT_GUARD_HOURS * HOUR_MS,
        ),
      },
    },
    select: { registrationId: true, timeZone: true },
    // At most two local days overlap a 20-hour window, so two rows per phone.
    take: zoneByRegistration.size * 2,
  })
  const guarded = new Set<string>()
  for (const row of recent) {
    if (row.registrationId == null) continue
    if (zoneByRegistration.get(row.registrationId) !== row.timeZone) {
      guarded.add(row.registrationId)
    }
  }
  return guarded
}

/** Phones this campaign already holds a live row for, which a replay re-reads. */
async function readOwnRows(
  prisma: PrismaClient,
  input: { campaignId: string; registrationIds: readonly string[] },
): Promise<Set<string>> {
  if (input.registrationIds.length === 0) return new Set()
  const rows = await prisma.pushDelivery.findMany({
    where: {
      campaignId: input.campaignId,
      kind: PushDeliveryKind.LIVE,
      registrationId: { in: [...input.registrationIds] },
    },
    select: { registrationId: true },
    take: input.registrationIds.length,
  })
  return new Set(
    rows.flatMap((row) => (row.registrationId ? [row.registrationId] : [])),
  )
}

async function writeSuppressed(
  prisma: PrismaClient,
  input: {
    campaignId: string
    now: Date
    candidates: readonly PushClaimCandidate[]
    suppressed: readonly PushClaimSuppression[]
  },
): Promise<void> {
  if (input.suppressed.length === 0) return
  const byRegistration = new Map(
    input.candidates.map((row) => [row.registrationId, row]),
  )
  const rows: ClaimInsertRow[] = []
  const errors: string[] = []
  for (const loss of input.suppressed) {
    const candidate = byRegistration.get(loss.registrationId)
    if (!candidate) continue
    rows.push({
      ...candidate,
      id: randomUUID(),
      nonce: nextPushDeliveryNonce(),
    })
    errors.push(loss.reason)
  }
  if (rows.length === 0) return
  await prisma.$queryRaw(
    insertStatement({
      campaignId: input.campaignId,
      kind: PushDeliveryKind.LIVE,
      status: PushDeliveryStatus.SUPPRESSED,
      now: input.now,
      rows,
      errors,
    }),
  )
}

/**
 * Moves exactly the reserved rows named, and only while the campaign holds the
 * status the caller expects. One statement, so a replay with any cursor
 * resends only rows still reserved. A test send passes `null`, because its
 * campaign is not sending.
 *
 * Call it per provider chunk: the statement binds one parameter per id.
 */
export async function moveReservedToSending(
  prisma: PrismaClient,
  input: {
    campaignId: string
    deliveryIds: readonly string[]
    expectedCampaignStatus?: PushCampaignStatus | null
    now?: Date
  },
): Promise<PushSendingDelivery[]> {
  if (input.deliveryIds.length === 0) return []
  const now = input.now ?? new Date()
  const expected =
    input.expectedCampaignStatus === undefined
      ? PushCampaignStatus.SENDING
      : input.expectedCampaignStatus
  const campaignGate = expected
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM push_campaign c
        WHERE c.id = ${input.campaignId}
          AND c.status = ${expected.toLowerCase()}::"PushCampaignStatus"
      )`
    : Prisma.empty
  const rows = await prisma.$queryRaw<SendingRow[]>(Prisma.sql`
    UPDATE push_delivery
    SET status = 'sending'::"PushDeliveryStatus",
        sending_at = ${now},
        updated_at = ${now}
    WHERE id IN (${Prisma.join([...input.deliveryIds])})
      AND campaign_id = ${input.campaignId}
      AND status = 'reserved'::"PushDeliveryStatus"
      ${campaignGate}
    RETURNING id, nonce, registration_id, language_slug, country, time_zone
  `)
  return rows.map((row) => ({
    id: row.id,
    nonce: row.nonce,
    registrationId: row.registration_id,
    languageSlug: row.language_slug,
    country: row.country,
    timeZone: row.time_zone,
  }))
}

/**
 * Returns a chunk that never reached the provider. A failure after the request
 * left is not reverted: loss is accepted and duplication is not.
 */
export async function revertSendingToReserved(
  prisma: PrismaClient,
  input: {
    campaignId: string
    deliveryIds: readonly string[]
    now?: Date
  },
): Promise<number> {
  if (input.deliveryIds.length === 0) return 0
  const { count } = await prisma.pushDelivery.updateMany({
    where: {
      id: { in: [...input.deliveryIds] },
      campaignId: input.campaignId,
      status: PushDeliveryStatus.SENDING,
    },
    data: {
      status: PushDeliveryStatus.RESERVED,
      sendingAt: null,
      updatedAt: input.now ?? new Date(),
    },
  })
  return count
}

/**
 * KTD11 and KTD12 — the rows a late or paused group leaves behind. A missed
 * row sits outside the daily-claim index, so it never consumes the phone's
 * day.
 */
export async function markPushReservedAsMissed(
  prisma: PrismaClient,
  input: {
    campaignId: string
    timeZones?: readonly string[]
    limit?: number
  },
): Promise<number> {
  const take = input.limit ?? PUSH_MISSED_PAGE_LIMIT
  if (!Number.isInteger(take) || take < 1) {
    throw new PushInputError(`The missed page limit ${take} is invalid`)
  }
  const where = {
    campaignId: input.campaignId,
    kind: PushDeliveryKind.LIVE,
    status: PushDeliveryStatus.RESERVED,
    ...(input.timeZones ? { timeZone: { in: [...input.timeZones] } } : {}),
  }
  const page = await prisma.pushDelivery.findMany({
    where,
    orderBy: { id: "asc" },
    take,
    select: { id: true },
  })
  if (page.length === 0) return 0
  const { count } = await prisma.pushDelivery.updateMany({
    // The status stays in the WHERE clause: a row the dispatcher moved
    // between the read and the write is not this call's to take.
    where: { ...where, id: { in: page.map((row) => row.id) } },
    data: { status: PushDeliveryStatus.MISSED },
  })
  return count
}

/**
 * One conditional update. `true` means this call made the move; `false` means
 * the campaign was not in a status the caller expected, which is the race
 * discriminator, not an error.
 */
export async function transitionPushCampaignStatus(
  prisma: PrismaClient,
  input: {
    campaignId: string
    from: readonly PushCampaignStatus[]
    to: PushCampaignStatus
    actorId?: string | null
    data?: Prisma.PushCampaignUpdateManyMutationInput
  },
): Promise<boolean> {
  const { count } = await prisma.pushCampaign.updateMany({
    where: { id: input.campaignId, status: { in: [...input.from] } },
    data: {
      ...input.data,
      status: input.to,
      ...(input.actorId === undefined ? {} : { lastActorId: input.actorId }),
    },
  })
  return count === 1
}

export async function transitionPushZoneStatus(
  prisma: PrismaClient,
  input: {
    zoneId: string
    from: readonly PushZoneStatus[]
    to: PushZoneStatus
    data?: Prisma.PushCampaignZoneUpdateManyMutationInput
  },
): Promise<boolean> {
  const { count } = await prisma.pushCampaignZone.updateMany({
    where: { id: input.zoneId, status: { in: [...input.from] } },
    data: { ...input.data, status: input.to },
  })
  return count === 1
}

/**
 * R11 — cancel stops the waves that have not started. A dispatching group is
 * left alone so its run still reconciles the receipts it is owed.
 */
export async function cancelPendingPushZones(
  prisma: PrismaClient,
  campaignId: string,
): Promise<number> {
  const { count } = await prisma.pushCampaignZone.updateMany({
    where: { campaignId, status: PushZoneStatus.PENDING },
    data: { status: PushZoneStatus.CANCELLED },
  })
  return count
}
