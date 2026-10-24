/**
 * R19 and KTD15 — reconciling what the provider did with each accepted row.
 *
 * Receipts expire about a day after the send and a wave lasts about 26 hours,
 * so a group past 20 hours is always reconciled first. Everything else is read
 * oldest first, one bounded page at a time, and the step budget is spent one
 * provider request at a time.
 */
import { Prisma, PushDeliveryStatus, type PrismaClient } from "@prisma/client"
import Expo from "expo-server-sdk"

import { assertParallelArrayLengthsMatch, toPgArray } from "@/db/pgvector"

import { shouldDeferNextPushChunk } from "./batch"
import { PushInputError } from "./errors"
import type {
  PushReceiptOutcome,
  PushSendConfig,
  PushTransport,
} from "./transport"

/** A send younger than this has not had time to produce a receipt. */
export const PUSH_RECEIPT_MIN_AGE_MS = 15 * 60_000
/** Past this age a receipt is about to expire, so the group jumps the queue. */
export const PUSH_RECEIPT_FORCE_AGE_MS = 20 * 60 * 60_000
/**
 * The provider answers at most this many ticket ids per request, so a request
 * is also the unit the step budget measures. The value is the SDK's own limit.
 */
export const PUSH_RECEIPT_REQUEST_SIZE =
  Expo.pushNotificationReceiptChunkSizeLimit
/** The width of the delivery row's error column. */
const PUSH_ERROR_MAX_LENGTH = 64

export type PushReceiptGroup = Readonly<{
  /** The oldest send in the group. A receipt expires about a day after it. */
  sentAt: Date
  timeZones: string[]
}>

export type PushReceiptRow = Readonly<{
  id: string
  ticketId: string
  registrationId: string | null
}>

export type PushReceiptCounts = Readonly<{
  handedOff: number
  failed: number
  invalid: number
  unknown: number
  /** Rows the provider has not answered yet. They stay accepted. */
  pending: number
}>

export type PushReceiptResult = Readonly<{
  status: "exhausted" | "deferred"
  counts: PushReceiptCounts
}>

export type PushReceiptStore = {
  readReconcilableGroups(input: {
    campaignId: string
    minAgeMs: number
    now: Date
  }): Promise<PushReceiptGroup[]>
  readAcceptedPage(input: {
    campaignId: string
    timeZones: readonly string[]
    cursor: string | null
    limit: number
  }): Promise<{ rows: PushReceiptRow[]; nextCursor: string | null }>
  readStaleSendingPage(input: {
    campaignId: string
    before: Date
    limit: number
  }): Promise<{ id: string }[]>
  recordHandedOff(ids: readonly string[]): Promise<void>
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
  recordUnknown(ids: readonly string[]): Promise<void>
}

export type PushReceiptDeps = {
  store: PushReceiptStore
  transport: PushTransport
  config: PushSendConfig
  now?: () => Date
}

/** The step budget, counted in provider requests rather than in pages. */
type PushStepBudget = Readonly<{
  spent(): boolean
  countRequest(): void
}>

const EMPTY: PushReceiptCounts = {
  handedOff: 0,
  failed: 0,
  invalid: 0,
  unknown: 0,
  pending: 0,
}

/** The force rule first, then oldest first. */
export function orderPushReceiptGroups(
  groups: readonly PushReceiptGroup[],
  now: Date,
): PushReceiptGroup[] {
  const forced = (group: PushReceiptGroup) =>
    now.getTime() - group.sentAt.getTime() >= PUSH_RECEIPT_FORCE_AGE_MS
  return [...groups].sort((left, right) => {
    const leftForced = forced(left)
    const rightForced = forced(right)
    if (leftForced !== rightForced) return leftForced ? -1 : 1
    return left.sentAt.getTime() - right.sentAt.getTime()
  })
}

/**
 * Collects the zones still waiting on receipts into groups.
 *
 * Zones the campaign planned for one instant reconcile together, so one page
 * read covers them all. A zone with no planned instant groups on its own.
 */
export function groupPushReceiptWork(
  zones: readonly { timeZone: string; oldestSentAt: Date }[],
  instantByZone: ReadonlyMap<string, number>,
): PushReceiptGroup[] {
  const groups = new Map<string, { sentAt: Date; timeZones: string[] }>()
  for (const zone of zones) {
    const instant = instantByZone.get(zone.timeZone)
    const key = instant == null ? `zone:${zone.timeZone}` : `instant:${instant}`
    const group = groups.get(key)
    if (!group) {
      groups.set(key, {
        sentAt: zone.oldestSentAt,
        timeZones: [zone.timeZone],
      })
      continue
    }
    group.timeZones.push(zone.timeZone)
    if (zone.oldestSentAt.getTime() < group.sentAt.getTime()) {
      group.sentAt = zone.oldestSentAt
    }
  }
  return [...groups.values()].map((group) => ({
    sentAt: group.sentAt,
    timeZones: [...group.timeZones].sort(),
  }))
}

export async function reconcilePushCampaignReceipts(
  input: { campaignId: string; minAgeMs?: number },
  deps: PushReceiptDeps,
): Promise<PushReceiptResult> {
  const { store, transport, config } = deps
  const now = deps.now ?? (() => new Date())
  const startedAt = now().getTime()
  const minAgeMs = input.minAgeMs ?? PUSH_RECEIPT_MIN_AGE_MS
  let counts = EMPTY
  let requestsMade = 0
  let deferred = false

  // One page holds thousands of tickets and the provider answers 300 per
  // request, so the budget is measured per request; per page it would overrun
  // the step by minutes.
  const budget: PushStepBudget = {
    spent: () =>
      shouldDeferNextPushChunk({
        chunksStarted: requestsMade,
        elapsedMs: now().getTime() - startedAt,
        stepMaxDurationMs: config.stepMaxDurationMs,
        stepReserveMs: config.stepReserveMs,
      }),
    countRequest: () => {
      requestsMade += 1
    },
  }

  const groups = orderPushReceiptGroups(
    await store.readReconcilableGroups({
      campaignId: input.campaignId,
      minAgeMs,
      now: now(),
    }),
    now(),
  )

  for (const group of groups) {
    let cursor: string | null = null
    do {
      if (budget.spent()) {
        deferred = true
        break
      }

      const page = await store.readAcceptedPage({
        campaignId: input.campaignId,
        timeZones: group.timeZones,
        cursor,
        limit: config.receiptPageSize,
      })
      if (page.rows.length > 0) {
        const applied = await applyReceipts({
          rows: page.rows,
          counts,
          store,
          transport,
          budget,
        })
        counts = applied.counts
        if (applied.deferred) {
          deferred = true
          break
        }
      }
      cursor = page.nextCursor
    } while (cursor != null)
    if (deferred) break
  }

  if (!deferred) {
    // A row that reached sending and never got a ticket has an unknown outcome:
    // the request may have left, so it is never resent.
    const stale = await store.readStaleSendingPage({
      campaignId: input.campaignId,
      before: new Date(now().getTime() - PUSH_RECEIPT_MIN_AGE_MS),
      limit: config.receiptPageSize,
    })
    if (stale.length > 0) {
      await store.recordUnknown(stale.map((row) => row.id))
      counts = { ...counts, unknown: counts.unknown + stale.length }
    }
  }

  console.info(
    `[push] event=receipts_reconciled campaign=${input.campaignId} groups=${groups.length} handed_off=${counts.handedOff} failed=${counts.failed} invalid=${counts.invalid} unknown=${counts.unknown} pending=${counts.pending}`,
  )
  return { status: deferred ? "deferred" : "exhausted", counts }
}

/**
 * Applies one page, one provider request at a time.
 *
 * Each request's rows are written before the next request starts, so a page the
 * budget cuts short keeps every outcome it already applied.
 */
async function applyReceipts(input: {
  rows: readonly PushReceiptRow[]
  counts: PushReceiptCounts
  store: PushReceiptStore
  transport: PushTransport
  budget: PushStepBudget
}): Promise<{ counts: PushReceiptCounts; deferred: boolean }> {
  const { store, transport, budget } = input
  const byTicket = new Map(input.rows.map((row) => [row.ticketId, row]))
  const tickets = [...byTicket.keys()]
  let counts = input.counts

  for (
    let start = 0;
    start < tickets.length;
    start += PUSH_RECEIPT_REQUEST_SIZE
  ) {
    if (budget.spent()) return { counts, deferred: true }
    budget.countRequest()

    const request = tickets.slice(start, start + PUSH_RECEIPT_REQUEST_SIZE)
    const receipts = await transport.fetchReceipts(request)

    const handedOff: string[] = []
    const failed: { id: string; error: string }[] = []
    const dead: {
      deliveryId: string
      registrationId: string | null
      error: string
    }[] = []
    let pending = 0

    for (const ticketId of request) {
      const row = byTicket.get(ticketId)
      if (!row) continue
      const outcome: PushReceiptOutcome | undefined = receipts.get(ticketId)
      if (!outcome) {
        pending += 1
        continue
      }
      if (outcome.kind === "handed_off") handedOff.push(row.id)
      else if (outcome.kind === "dead_token") {
        dead.push({
          deliveryId: row.id,
          registrationId: row.registrationId,
          error: outcome.providerCode,
        })
      } else failed.push({ id: row.id, error: outcome.providerCode })
    }

    if (handedOff.length > 0) await store.recordHandedOff(handedOff)
    if (failed.length > 0) {
      await store.recordFailed(failed, PushDeliveryStatus.FAILED)
    }
    if (dead.length > 0) await store.recordDeadTokens(dead)

    counts = {
      handedOff: counts.handedOff + handedOff.length,
      failed: counts.failed + failed.length,
      invalid: counts.invalid + dead.length,
      unknown: counts.unknown,
      pending: counts.pending + pending,
    }
  }

  return { counts, deferred: false }
}

/**
 * The provider's code, fitted to the error column.
 *
 * A brace is structural in a Postgres array literal, so one odd provider code
 * would otherwise fail the whole page on the way into `unnest`.
 */
function pushErrorColumn(error: string): string {
  return error.replace(/[{}]/g, "").slice(0, PUSH_ERROR_MAX_LENGTH)
}

function errorPairStatement(input: {
  ids: readonly string[]
  errors: readonly string[]
  status: PushDeliveryStatus
  now: Date
}): Prisma.Sql {
  assertParallelArrayLengthsMatch(
    input.ids.length,
    [{ name: "errors", length: input.errors.length }],
    (message) => new PushInputError(message),
  )
  return Prisma.sql`
    UPDATE push_delivery
    SET status = ${input.status.toLowerCase()}::"PushDeliveryStatus",
        error = v.error,
        updated_at = ${input.now}
    FROM unnest(
      ${toPgArray([...input.ids])}::text[],
      ${toPgArray([...input.errors])}::text[]
    ) AS v(id, error)
    WHERE push_delivery.id = v.id
      AND push_delivery.status = 'accepted'::"PushDeliveryStatus"
  `
}

/** The one implementation of the port, over Prisma. */
export function createPushReceiptStore(prisma: PrismaClient): PushReceiptStore {
  return {
    async readReconcilableGroups({ campaignId, minAgeMs, now }) {
      // The work is the rows still waiting, never the zone's status: a wave the
      // flag paused or cancelled mid-dispatch stamps no dispatchedAt, and its
      // accepted rows still hold tickets that expire.
      const waiting = await prisma.pushDelivery.groupBy({
        by: ["timeZone"],
        where: {
          campaignId,
          status: PushDeliveryStatus.ACCEPTED,
          ticketId: { not: null },
          sendingAt: { lte: new Date(now.getTime() - minAgeMs) },
        },
        _min: { sendingAt: true },
      })
      const zonesWaiting = waiting.flatMap((row) =>
        row._min.sendingAt
          ? [{ timeZone: row.timeZone, oldestSentAt: row._min.sendingAt }]
          : [],
      )
      if (zonesWaiting.length === 0) return []
      const planned = await prisma.pushCampaignZone.findMany({
        where: {
          campaignId,
          timeZone: { in: zonesWaiting.map((zone) => zone.timeZone) },
        },
        select: { timeZone: true, scheduledAt: true },
      })
      return groupPushReceiptWork(
        zonesWaiting,
        new Map(
          planned.map((zone) => [zone.timeZone, zone.scheduledAt.getTime()]),
        ),
      )
    },
    async readAcceptedPage({ campaignId, timeZones, cursor, limit }) {
      const rows = await prisma.pushDelivery.findMany({
        where: {
          campaignId,
          status: PushDeliveryStatus.ACCEPTED,
          ticketId: { not: null },
          timeZone: { in: [...timeZones] },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: limit,
        select: { id: true, ticketId: true, registrationId: true },
      })
      return {
        rows: rows.flatMap((row) =>
          row.ticketId
            ? [
                {
                  id: row.id,
                  ticketId: row.ticketId,
                  registrationId: row.registrationId,
                },
              ]
            : [],
        ),
        nextCursor: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
      }
    },
    async readStaleSendingPage({ campaignId, before, limit }) {
      return prisma.pushDelivery.findMany({
        where: {
          campaignId,
          status: PushDeliveryStatus.SENDING,
          ticketId: null,
          sendingAt: { lte: before },
        },
        orderBy: { id: "asc" },
        take: limit,
        select: { id: true },
      })
    },
    async recordHandedOff(ids) {
      await prisma.pushDelivery.updateMany({
        where: { id: { in: [...ids] }, status: PushDeliveryStatus.ACCEPTED },
        data: { status: PushDeliveryStatus.HANDED_OFF },
      })
    },
    async recordFailed(rows, status) {
      if (rows.length === 0) return
      await prisma.$executeRaw(
        errorPairStatement({
          ids: rows.map((row) => row.id),
          errors: rows.map((row) => pushErrorColumn(row.error)),
          status,
          now: new Date(),
        }),
      )
    },
    async recordDeadTokens(rows) {
      if (rows.length === 0) return
      const registrationIds = rows.flatMap((row) =>
        row.registrationId ? [row.registrationId] : [],
      )
      const now = new Date()
      // KTD1 — the delivery and the registration retire together, so a dead
      // token never appears in a later audience.
      await prisma.$transaction([
        prisma.$executeRaw(
          errorPairStatement({
            ids: rows.map((row) => row.deliveryId),
            errors: rows.map((row) => pushErrorColumn(row.error)),
            status: PushDeliveryStatus.INVALID,
            now,
          }),
        ),
        ...(registrationIds.length > 0
          ? [
              prisma.pushRegistration.updateMany({
                where: { id: { in: registrationIds } },
                data: { status: "INVALID", statusChangedAt: now },
              }),
            ]
          : []),
      ])
    },
    async recordUnknown(ids) {
      await prisma.pushDelivery.updateMany({
        where: { id: { in: [...ids] }, status: PushDeliveryStatus.SENDING },
        data: { status: PushDeliveryStatus.UNKNOWN },
      })
    },
  }
}
