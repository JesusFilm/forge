/**
 * R19 and KTD15 — reconciling what the provider did with each accepted row.
 *
 * Receipts expire about a day after the send and a wave lasts about 26 hours,
 * so a group past 20 hours is always reconciled first. Everything else is read
 * oldest first, one bounded page at a time, under the same step budget the send
 * uses.
 */
import { PushDeliveryStatus, type PrismaClient } from "@prisma/client"

import { shouldDeferNextPushChunk } from "./batch"
import type {
  PushReceiptOutcome,
  PushSendConfig,
  PushTransport,
} from "./transport"

/** A group younger than this has not had time to produce receipts. */
export const PUSH_RECEIPT_MIN_AGE_MS = 15 * 60_000
/** Past this age a receipt is about to expire, so the group jumps the queue. */
export const PUSH_RECEIPT_FORCE_AGE_MS = 20 * 60 * 60_000

export type PushReceiptGroup = Readonly<{
  instant: Date
  dispatchedAt: Date
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
    now.getTime() - group.dispatchedAt.getTime() >= PUSH_RECEIPT_FORCE_AGE_MS
  return [...groups].sort((left, right) => {
    const leftForced = forced(left)
    const rightForced = forced(right)
    if (leftForced !== rightForced) return leftForced ? -1 : 1
    return left.dispatchedAt.getTime() - right.dispatchedAt.getTime()
  })
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
  let pagesRead = 0
  let deferred = false

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
      if (
        shouldDeferNextPushChunk({
          chunksStarted: pagesRead,
          elapsedMs: now().getTime() - startedAt,
          stepMaxDurationMs: config.stepMaxDurationMs,
          stepReserveMs: config.stepReserveMs,
        })
      ) {
        deferred = true
        break
      }
      pagesRead += 1

      const page = await store.readAcceptedPage({
        campaignId: input.campaignId,
        timeZones: group.timeZones,
        cursor,
        limit: config.receiptPageSize,
      })
      if (page.rows.length > 0) {
        counts = await applyReceipts({
          rows: page.rows,
          counts,
          store,
          transport,
        })
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

async function applyReceipts(input: {
  rows: readonly PushReceiptRow[]
  counts: PushReceiptCounts
  store: PushReceiptStore
  transport: PushTransport
}): Promise<PushReceiptCounts> {
  const { rows, store, transport } = input
  const byTicket = new Map(rows.map((row) => [row.ticketId, row]))
  const receipts = await transport.fetchReceipts([...byTicket.keys()])

  const handedOff: string[] = []
  const failed: { id: string; error: string }[] = []
  const dead: {
    deliveryId: string
    registrationId: string | null
    error: string
  }[] = []
  let pending = 0

  for (const [ticketId, row] of byTicket) {
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

  return {
    handedOff: input.counts.handedOff + handedOff.length,
    failed: input.counts.failed + failed.length,
    invalid: input.counts.invalid + dead.length,
    unknown: input.counts.unknown,
    pending: input.counts.pending + pending,
  }
}

/** The one implementation of the port, over Prisma. */
export function createPushReceiptStore(prisma: PrismaClient): PushReceiptStore {
  return {
    async readReconcilableGroups({ campaignId, minAgeMs, now }) {
      const rows = await prisma.pushCampaignZone.findMany({
        where: {
          campaignId,
          status: { in: ["DISPATCHING", "DISPATCHED"] },
          dispatchedAt: { not: null, lte: new Date(now.getTime() - minAgeMs) },
        },
        orderBy: { scheduledAt: "asc" },
        select: { timeZone: true, scheduledAt: true, dispatchedAt: true },
      })
      const byInstant = new Map<number, PushReceiptGroup>()
      for (const row of rows) {
        if (!row.dispatchedAt) continue
        const key = row.scheduledAt.getTime()
        const group = byInstant.get(key)
        if (group) {
          group.timeZones.push(row.timeZone)
          continue
        }
        byInstant.set(key, {
          instant: row.scheduledAt,
          dispatchedAt: row.dispatchedAt,
          timeZones: [row.timeZone],
        })
      }
      return [...byInstant.values()].map((group) => ({
        ...group,
        timeZones: [...group.timeZones].sort(),
      }))
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
      await prisma.$transaction(
        rows.map((row) =>
          prisma.pushDelivery.updateMany({
            where: { id: row.id, status: PushDeliveryStatus.ACCEPTED },
            data: { status, error: row.error.slice(0, 64) },
          }),
        ),
      )
    },
    async recordDeadTokens(rows) {
      const registrationIds = rows.flatMap((row) =>
        row.registrationId ? [row.registrationId] : [],
      )
      await prisma.$transaction([
        ...rows.map((row) =>
          prisma.pushDelivery.updateMany({
            where: {
              id: row.deliveryId,
              status: PushDeliveryStatus.ACCEPTED,
            },
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
    async recordUnknown(ids) {
      await prisma.pushDelivery.updateMany({
        where: { id: { in: [...ids] }, status: PushDeliveryStatus.SENDING },
        data: { status: PushDeliveryStatus.UNKNOWN },
      })
    },
  }
}
