import { createHash, randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { assertWebRecommendationCaller } from "./caller"
import {
  RecommendationAuthenticationError,
  RecommendationInputError,
} from "./errors"
import { recommendationTraffic } from "./traffic"
import { env } from "@/config/env"
import { dispatchRecommendationEventsAfterCommit } from "./event-history/runtime"
import type { RecommendationEventEnvelope } from "./event-history/envelope"
import {
  encodeWatchHistoryFact,
  watchExactDigest,
  watchGroupDigest,
  type WatchHistoryFact,
} from "./watch-event-history"
import { WATCH_SURFACE_EXPOSURE_RETENTION_MS } from "./watch-surface-exposure-retention"
import { registeredAnonymousWatchSurface } from "./watch-surface-registry"

const Event = z
  .object({
    eventId: z.string().uuid(),
    windowId: z.string().uuid(),
    surface: z.string().min(1).max(40),
    block: z.string().min(1).max(40),
    presentation: z.string().min(1).max(40),
    placement: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    policyVersion: z.enum(["watch-exposure-v1", "watch-exposure-v2"]),
    position: z.number().int().min(0).max(99),
    itemPath: z
      .string()
      .max(512)
      .regex(/^\/watch\/[a-zA-Z0-9_-]+\.html(?:\/[a-zA-Z0-9_-]+\.html){0,2}$/),
    kind: z.enum(["rendered", "eligible", "selected"]),
    visibilityCapability: z.enum(["unknown", "occlusion-aware"]).nullable(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type WatchSurfaceExposureEvent = z.infer<typeof Event>
export type WatchSurfaceExposureReceipt = {
  eventId: string
  status: "accepted" | "replay" | "repeat" | "conflict"
}

type ParsedEvent = Omit<WatchSurfaceExposureEvent, "occurredAt"> & {
  occurredAt: Date
}

type StoredEvent = ParsedEvent & {
  id: string
  receivedAt: Date
  expiresAt: Date
  duplicateCount: number
  repeated: boolean
}

function parseEvent(raw: unknown, now: Date): ParsedEvent {
  if (Buffer.byteLength(JSON.stringify(raw)) > 2048) {
    throw new RecommendationInputError("Watch exposure event is too large")
  }
  const parsed = Event.safeParse(raw)
  if (!parsed.success) {
    throw new RecommendationInputError("Watch exposure event is invalid")
  }
  const event = parsed.data
  if (
    !registeredAnonymousWatchSurface(
      event.surface,
      event.block,
      event.presentation,
      event.policyVersion,
    )
  ) {
    throw new RecommendationInputError("Watch exposure surface is unregistered")
  }
  if ((event.kind === "eligible") !== (event.visibilityCapability != null)) {
    throw new RecommendationInputError(
      "Watch exposure visibility capability is invalid",
    )
  }
  const occurredAt = new Date(event.occurredAt)
  if (Math.abs(occurredAt.getTime() - now.getTime()) > 5 * 60_000) {
    throw new RecommendationInputError("Watch exposure timestamp is invalid")
  }
  return { ...event, occurredAt }
}

function sameEvent(
  stored: {
    windowId: string
    surface: string
    block: string
    presentation: string
    placement: string
    policyVersion: string
    position: number
    itemPath: string
    kind: string
    visibilityCapability: string | null
    occurredAt: Date
  },
  event: ParsedEvent,
): boolean {
  return (
    stored.windowId === event.windowId &&
    stored.surface === event.surface &&
    stored.block === event.block &&
    stored.presentation === event.presentation &&
    stored.placement === event.placement &&
    stored.policyVersion === event.policyVersion &&
    stored.position === event.position &&
    stored.itemPath === event.itemPath &&
    stored.kind === event.kind &&
    stored.visibilityCapability === event.visibilityCapability &&
    stored.occurredAt.getTime() === event.occurredAt.getTime()
  )
}

const Manifest = Event.pick({
  surface: true,
  block: true,
  presentation: true,
  placement: true,
})
  .extend({
    policyVersion: z.literal("watch-exposure-v2"),
    items: z
      .array(Event.pick({ position: true, itemPath: true }).strict())
      .max(100),
    sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type WatchSurfaceDeliveryReceipt = {
  windowId: string | null
  disposition: "measured" | "deferred" | "contextual"
  status: "accepted" | "replay" | "conflict"
  items: { position: number; itemPath: string }[]
}

function digestUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function dispatchWatchFacts(facts: WatchHistoryFact[], acceptedAt: Date): void {
  if (env.WATCH_EVENT_EXPORT_ENABLED !== "true" || facts.length === 0) return
  const envelopes: RecommendationEventEnvelope[] = []
  for (const fact of facts) {
    try {
      envelopes.push(encodeWatchHistoryFact(fact, acceptedAt))
    } catch {
      // Optional history must not change completed operational admission.
      console.warn("watch_event_export_prepare_failed")
    }
  }
  if (envelopes.length) {
    try {
      dispatchRecommendationEventsAfterCommit(envelopes)
    } catch {
      console.warn("watch_event_export_dispatch_failed")
    }
  }
}

function watchAdmissionMode(): "legacy" | "shadow" | "compact" {
  return env.WATCH_COMPACT_ADMISSION_MODE ?? "legacy"
}

/** Only the authenticated origin may issue an already verified source manifest. */
export async function issueWatchSurfaceDelivery(
  prisma: PrismaClient,
  caller: Principal | null,
  input: {
    manifest: unknown
    attemptId: string
    trafficCategory?: string | null
  },
  now = new Date(),
): Promise<WatchSurfaceDeliveryReceipt> {
  if (caller?.fleet === true) throw new RecommendationAuthenticationError()
  const traffic = recommendationTraffic({
    caller,
    trafficCategory: input.trafficCategory,
  })
  if (traffic.disposition !== "measured") {
    return {
      windowId: null,
      disposition: traffic.disposition,
      status: "accepted",
      items: [],
    }
  }
  const parsed = Manifest.safeParse(input.manifest)
  if (
    !parsed.success ||
    !z.string().uuid().safeParse(input.attemptId).success ||
    Buffer.byteLength(JSON.stringify(input.manifest)) > 64 * 1024
  ) {
    throw new RecommendationInputError("Watch served manifest is invalid")
  }
  const manifest = parsed.data
  if (
    !registeredAnonymousWatchSurface(
      manifest.surface,
      manifest.block,
      manifest.presentation,
      manifest.policyVersion,
    ) ||
    new Date(manifest.expiresAt).getTime() <= now.getTime() ||
    new Date(manifest.expiresAt).getTime() > now.getTime() + 48 * 60 * 60_000 ||
    new Set(manifest.items.map((item) => `${item.position}:${item.itemPath}`))
      .size !== manifest.items.length
  ) {
    throw new RecommendationInputError(
      "Watch served manifest binding is invalid",
    )
  }
  if (manifest.items.length === 0) {
    return {
      windowId: null,
      disposition: "measured",
      status: "accepted",
      items: [],
    }
  }
  const windowId = digestUuid(`watch-served-window-v2:${input.attemptId}`)
  // Explicit canonical ordering binds all immutable source metadata without storing it.
  const binding = JSON.stringify([
    manifest.surface,
    manifest.block,
    manifest.presentation,
    manifest.placement,
    manifest.policyVersion,
    manifest.sourceVersion,
    manifest.expiresAt,
    manifest.items.map(({ position, itemPath }) => [position, itemPath]),
  ])
  const rows = manifest.items.map((item) => ({
    eventId: digestUuid(
      `${windowId}:${binding}:${item.position}:${item.itemPath}`,
    ),
    windowId,
    surface: manifest.surface,
    block: manifest.block,
    presentation: manifest.presentation,
    placement: manifest.placement,
    policyVersion: manifest.policyVersion,
    ...item,
    kind: "served",
    visibilityCapability: null,
    occurredAt: now,
    expiresAt: new Date(now.getTime() + WATCH_SURFACE_EXPOSURE_RETENTION_MS),
  }))
  if (watchAdmissionMode() !== "legacy") {
    const digest = createHash("sha256").update(binding).digest("hex")
    const facts: WatchHistoryFact[] = rows.map((row) => ({
      ...row,
      rankId: randomUUID(),
      receivedAt: now,
      duplicateCount: 0,
      revision: 1,
    }))
    const receipt = await prisma.$transaction(
      async (tx): Promise<WatchSurfaceDeliveryReceipt> => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'")
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${windowId}, 373))`
        const legacy = await tx.watchSurfaceExposure.findMany({
          where: { windowId, kind: "served" },
          orderBy: { position: "asc" },
        })
        if (legacy.length) {
          const matches =
            legacy.length === rows.length &&
            legacy.every(
              (row) =>
                rows.some((expected) => expected.eventId === row.eventId) &&
                row.expiresAt > now,
            )
          return {
            windowId,
            disposition: "measured",
            status: matches ? "replay" : "conflict",
            items: matches
              ? manifest.items
              : legacy.map(({ position, itemPath }) => ({
                  position,
                  itemPath,
                })),
          }
        }
        const existing = await tx.watchSurfaceIssuedWindow.findUnique({
          where: { windowId },
          include: { items: true },
        })
        if (existing) {
          const matches =
            existing.manifestDigest === digest &&
            existing.expiresAt > now &&
            existing.itemCount === rows.length &&
            existing.items.length === rows.length &&
            existing.items.every((item) =>
              rows.some(
                (row) =>
                  row.eventId === item.servedEventId &&
                  row.position === item.position &&
                  row.itemPath === item.itemPath,
              ),
            )
          return {
            windowId,
            disposition: "measured",
            status: matches ? "replay" : "conflict",
            items: matches
              ? manifest.items
              : existing.items.map(({ position, itemPath }) => ({
                  position,
                  itemPath,
                })),
          }
        }
        await tx.watchSurfaceIssuedWindow.create({
          data: {
            windowId,
            manifestDigest: digest,
            surface: manifest.surface,
            block: manifest.block,
            presentation: manifest.presentation,
            placement: manifest.placement,
            issuedAt: now,
            expiresAt: rows[0].expiresAt,
            itemCount: rows.length,
            items: {
              create: rows.map(({ position, itemPath, eventId }) => ({
                position,
                itemPath,
                servedEventId: eventId,
              })),
            },
          },
        })
        if (watchAdmissionMode() === "shadow")
          await tx.watchSurfaceExposure.createMany({
            data: rows.map((row, index) => ({
              ...row,
              id: facts[index].rankId,
              receivedAt: now,
            })),
          })
        return {
          windowId,
          disposition: "measured",
          status: "accepted",
          items: manifest.items,
        }
      },
      { timeout: 4000, maxWait: 3000 },
    )
    if (receipt.status === "accepted") dispatchWatchFacts(facts, now)
    return receipt
  }
  return prisma.$transaction(
    async (tx): Promise<WatchSurfaceDeliveryReceipt> => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'")
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${windowId}, 373))`
      const existing = await tx.watchSurfaceExposure.findMany({
        where: { windowId, kind: "served" },
        orderBy: { position: "asc" },
      })
      if (existing.length > 0) {
        const matches =
          existing.length === rows.length &&
          existing.every(
            (row) =>
              rows.some((expected) => expected.eventId === row.eventId) &&
              row.expiresAt.getTime() > now.getTime(),
          )
        return {
          windowId,
          disposition: "measured",
          status: matches ? "replay" : "conflict",
          items: matches
            ? manifest.items
            : existing.map(({ position, itemPath }) => ({
                position,
                itemPath,
              })),
        }
      }
      await tx.watchSurfaceExposure.createMany({ data: rows })
      return {
        windowId,
        disposition: "measured",
        status: "accepted",
        items: manifest.items,
      }
    },
    { timeout: 4000, maxWait: 3000 },
  )
}

async function assertIssuedEvents(
  prisma: PrismaClient | Prisma.TransactionClient,
  events: ParsedEvent[],
  now: Date,
  includeCompact = false,
) {
  const issuedEvents = events.filter(
    (event) => event.policyVersion === "watch-exposure-v2",
  )
  const expiries = new Map<string, Date>()
  if (issuedEvents.length === 0) return expiries
  const served = await prisma.watchSurfaceExposure.findMany({
    where: {
      kind: "served",
      policyVersion: "watch-exposure-v2",
      windowId: {
        in: [...new Set(issuedEvents.map((event) => event.windowId))],
      },
      expiresAt: { gt: now },
    },
  })
  const compact = includeCompact
    ? await prisma.watchSurfaceIssuedWindow.findMany({
        where: {
          windowId: {
            in: [...new Set(issuedEvents.map((event) => event.windowId))],
          },
          expiresAt: { gt: now },
        },
        include: { items: true },
      })
    : []
  for (const event of issuedEvents) {
    const binding = served.find(
      (row) =>
        row.windowId === event.windowId &&
        row.surface === event.surface &&
        row.block === event.block &&
        row.presentation === event.presentation &&
        row.placement === event.placement &&
        row.position === event.position &&
        row.itemPath === event.itemPath,
    )
    const compactBinding = compact.find(
      (row) =>
        row.windowId === event.windowId &&
        row.surface === event.surface &&
        row.block === event.block &&
        row.presentation === event.presentation &&
        row.placement === event.placement &&
        row.items.some(
          (item) =>
            item.position === event.position &&
            item.itemPath === event.itemPath,
        ),
    )
    if (!binding && !compactBinding)
      throw new RecommendationInputError(
        "Watch exposure has no issued served binding",
      )
    expiries.set(event.eventId, (binding ?? compactBinding)!.expiresAt)
  }
  return expiries
}

export async function recordWatchSurfaceExposureBatch(
  prisma: PrismaClient,
  caller: Principal | null,
  raw: unknown,
  now = new Date(),
): Promise<WatchSurfaceExposureReceipt[]> {
  assertWebRecommendationCaller(caller)
  if (
    !Array.isArray(raw) ||
    raw.length < 1 ||
    raw.length > 64 ||
    Buffer.byteLength(JSON.stringify(raw)) > 48 * 1024
  ) {
    throw new RecommendationInputError("Watch exposure batch is invalid")
  }
  const events = raw.map((event) => parseEvent(event, now))
  if (watchAdmissionMode() !== "legacy") {
    const ids = [...new Set(events.map((event) => event.eventId))]
    const windows = [
      ...new Set(
        events
          .filter((event) => event.policyVersion === "watch-exposure-v2")
          .map((event) => event.windowId),
      ),
    ]
    // Pre-cutover rows lack the signed manifest source version and expiry. Keep
    // their original authority until their recorded expiry instead of guessing.
    const [compactWindows, compactReceipts, oldRows] = await Promise.all([
      prisma.watchSurfaceIssuedWindow.findMany({
        where: { windowId: { in: windows }, expiresAt: { gt: now } },
        select: { windowId: true },
      }),
      prisma.watchSurfaceEventReceipt.findMany({
        where: { eventId: { in: ids } },
        select: { eventId: true },
      }),
      prisma.watchSurfaceExposure.findMany({
        where: { eventId: { in: ids } },
        select: { eventId: true },
      }),
    ])
    const newWindows = new Set(compactWindows.map((row) => row.windowId))
    const newReceipts = new Set(compactReceipts.map((row) => row.eventId))
    if (
      windows.some((id) => !newWindows.has(id)) ||
      oldRows.some((row) => !newReceipts.has(row.eventId))
    )
      return recordMixedWatchSurfaceExposureBatch(prisma, events, now)
    return recordCompactWatchSurfaceExposureBatch(prisma, events, now)
  }
  return recordLegacyWatchSurfaceExposureBatch(prisma, events, now)
}

async function recordMixedWatchSurfaceExposureBatch(
  prisma: PrismaClient,
  events: ParsedEvent[],
  now: Date,
): Promise<WatchSurfaceExposureReceipt[]> {
  const windows = [...new Set(events.map((event) => event.windowId))].sort()
  const exported: WatchHistoryFact[] = []
  const receipts = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'")
      for (const windowId of windows)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${windowId}, 373))`
      return recordLegacyWatchSurfaceExposureBatch(
        tx,
        events,
        now,
        true,
        exported,
      )
    },
    { timeout: 4000, maxWait: 3000 },
  )
  dispatchWatchFacts(exported, now)
  return receipts
}

async function recordLegacyWatchSurfaceExposureBatch(
  prisma: PrismaClient | Prisma.TransactionClient,
  events: ParsedEvent[],
  now: Date,
  includeCompact = false,
  exportFacts?: WatchHistoryFact[],
): Promise<WatchSurfaceExposureReceipt[]> {
  const issuedExpiries = await assertIssuedEvents(
    prisma,
    events,
    now,
    includeCompact,
  )
  const unique = new Map<string, ParsedEvent>()
  for (const event of events) {
    if (!unique.has(event.eventId)) unique.set(event.eventId, event)
  }
  const compactRows = includeCompact
    ? await prisma.watchSurfaceEventReceipt.findMany({
        where: { eventId: { in: [...unique.keys()] } },
      })
    : []
  const compactById = new Map(compactRows.map((row) => [row.eventId, row]))
  const legacyUnique = [...unique.values()].filter(
    (event) => !compactById.has(event.eventId),
  )
  const inserted = await prisma.watchSurfaceExposure.createManyAndReturn({
    data: legacyUnique.map((event) => ({
      ...event,
      expiresAt:
        issuedExpiries.get(event.eventId) ??
        new Date(now.getTime() + WATCH_SURFACE_EXPOSURE_RETENTION_MS),
    })),
    skipDuplicates: true,
    select: { eventId: true },
  })
  const insertedIds = new Set(inserted.map(({ eventId }) => eventId))
  const ids = legacyUnique.map((event) => event.eventId)
  const stored = ids.length
    ? await prisma.$queryRaw<StoredEvent[]>`
    SELECT e.id, e.event_id AS "eventId", e.window_id AS "windowId",
           e.surface, e.block, e.presentation, e.placement,
           e.policy_version AS "policyVersion", e.position,
           e.item_path AS "itemPath", e.kind,
           e.visibility_capability AS "visibilityCapability",
           e.occurred_at AS "occurredAt", e.received_at AS "receivedAt",
           e.expires_at AS "expiresAt", e.duplicate_count AS "duplicateCount",
           EXISTS (
             SELECT 1 FROM watch_surface_exposure earlier
             WHERE earlier.window_id = e.window_id
               AND earlier.surface = e.surface
               AND earlier.block = e.block
               AND earlier.presentation = e.presentation
               AND earlier.placement = e.placement
               AND earlier.policy_version = e.policy_version
               AND earlier.position = e.position
               AND earlier.item_path = e.item_path
               AND earlier.kind = e.kind
               AND (earlier.occurred_at, earlier.received_at, earlier.id) <
                   (e.occurred_at, e.received_at, e.id)
           ) AS repeated
    FROM watch_surface_exposure e
    WHERE e.event_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
  `
    : []
  const storedById = new Map(stored.map((event) => [event.eventId, event]))
  const compactRepeated = new Set<string>()
  if (includeCompact) {
    for (const eventId of insertedIds) {
      const event = unique.get(eventId)!
      const row = storedById.get(eventId)!
      const [earlier] = await prisma.$queryRaw<Array<{ repeated: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM watch_surface_event_receipt
          WHERE window_id = ${row.windowId}::uuid
            AND group_digest = ${watchGroupDigest(event)}
            AND (occurred_at, received_at, rank_id::text) <
                (${row.occurredAt}, ${row.receivedAt}, ${row.id})
        ) AS repeated
      `
      if (earlier.repeated) compactRepeated.add(eventId)
    }
  }
  const firstSeen = new Set<string>()
  const replayCounts = new Map<string, number>()
  const receipts = events.map((event): WatchSurfaceExposureReceipt => {
    const compact = compactById.get(event.eventId)
    if (compact) {
      const status =
        compact.exactDigest === watchExactDigest(event) ? "replay" : "conflict"
      if (status === "replay")
        replayCounts.set(
          event.eventId,
          (replayCounts.get(event.eventId) ?? 0) + 1,
        )
      return { eventId: event.eventId, status }
    }
    const row = storedById.get(event.eventId)
    if (!row) throw new RecommendationInputError("Watch exposure write missing")
    const first = !firstSeen.has(event.eventId)
    firstSeen.add(event.eventId)
    let status: WatchSurfaceExposureReceipt["status"]
    if (!sameEvent(row, event)) {
      status = "conflict"
    } else if (first && insertedIds.has(event.eventId)) {
      status =
        row.repeated || compactRepeated.has(event.eventId)
          ? "repeat"
          : "accepted"
    } else {
      status = "replay"
      replayCounts.set(
        event.eventId,
        (replayCounts.get(event.eventId) ?? 0) + 1,
      )
    }
    return { eventId: event.eventId, status }
  })
  const replayIdsByCount = new Map<number, string[]>()
  for (const [eventId, count] of replayCounts) {
    if (compactById.has(eventId)) continue
    replayIdsByCount.set(count, [
      ...(replayIdsByCount.get(count) ?? []),
      eventId,
    ])
  }
  for (const [count, eventIds] of replayIdsByCount) {
    await prisma.watchSurfaceExposure.updateMany({
      where: { eventId: { in: eventIds } },
      data: { duplicateCount: { increment: count } },
    })
  }
  for (const [eventId, count] of replayCounts) {
    if (!compactById.has(eventId)) continue
    const row = await prisma.watchSurfaceEventReceipt.update({
      where: { eventId },
      data: {
        duplicateCount: { increment: count },
        revision: { increment: 1 },
      },
    })
    if (watchAdmissionMode() === "shadow")
      await prisma.watchSurfaceExposure.updateMany({
        where: { eventId },
        data: { duplicateCount: { increment: count } },
      })
    compactById.set(eventId, row)
  }
  if (exportFacts) {
    const allowed = new Set(
      receipts
        .filter((receipt) => receipt.status !== "conflict")
        .map((receipt) => receipt.eventId),
    )
    for (const eventId of allowed) {
      const compact = compactById.get(eventId)
      if (compact) {
        exportFacts.push({
          ...unique.get(eventId)!,
          rankId: compact.rankId,
          receivedAt: compact.receivedAt,
          expiresAt: compact.expiresAt,
          duplicateCount: compact.duplicateCount,
          revision: compact.revision,
        })
        continue
      }
      const row = storedById.get(eventId)!
      const total = row.duplicateCount + (replayCounts.get(eventId) ?? 0)
      exportFacts.push({
        ...unique.get(eventId)!,
        rankId: row.id,
        receivedAt: row.receivedAt,
        expiresAt: row.expiresAt,
        duplicateCount: total,
        revision: total + 1,
      })
    }
  }
  return receipts
}

async function recordCompactWatchSurfaceExposureBatch(
  prisma: PrismaClient,
  events: ParsedEvent[],
  now: Date,
): Promise<WatchSurfaceExposureReceipt[]> {
  const windows = [...new Set(events.map((event) => event.windowId))].sort()
  for (let attempt = 0; attempt < 2; attempt++) {
    const exported: WatchHistoryFact[] = []
    try {
      const receipts = await prisma.$transaction(
        async (tx): Promise<WatchSurfaceExposureReceipt[]> => {
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'")
          for (const windowId of windows)
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${windowId}, 373))`
          const issued = await tx.watchSurfaceIssuedWindow.findMany({
            where: { windowId: { in: windows }, expiresAt: { gt: now } },
            include: { items: true },
          })
          const expiries = new Map<string, Date>()
          for (const event of events) {
            if (event.policyVersion !== "watch-exposure-v2") continue
            const binding = issued.find(
              (row) =>
                row.windowId === event.windowId &&
                row.surface === event.surface &&
                row.block === event.block &&
                row.presentation === event.presentation &&
                row.placement === event.placement &&
                row.items.some(
                  (item) =>
                    item.position === event.position &&
                    item.itemPath === event.itemPath,
                ),
            )
            if (!binding)
              throw new RecommendationInputError(
                "Watch exposure has no issued served binding",
              )
            expiries.set(event.eventId, binding.expiresAt)
          }
          const unique = new Map<string, ParsedEvent>()
          for (const event of events)
            if (!unique.has(event.eventId)) unique.set(event.eventId, event)
          const existing = await tx.watchSurfaceEventReceipt.findMany({
            where: { eventId: { in: [...unique.keys()] } },
          })
          const existingById = new Map(
            existing.map((row) => [row.eventId, row]),
          )
          const inserted = new Set<string>()
          for (const event of unique.values()) {
            if (existingById.has(event.eventId)) continue
            const rankId = randomUUID()
            const row = await tx.watchSurfaceEventReceipt.create({
              data: {
                eventId: event.eventId,
                windowId: event.windowId,
                exactDigest: watchExactDigest(event),
                groupDigest: watchGroupDigest(event),
                occurredAt: event.occurredAt,
                receivedAt: now,
                rankId,
                expiresAt:
                  expiries.get(event.eventId) ??
                  new Date(now.getTime() + WATCH_SURFACE_EXPOSURE_RETENTION_MS),
              },
            })
            existingById.set(event.eventId, row)
            inserted.add(event.eventId)
            if (watchAdmissionMode() === "shadow")
              await tx.watchSurfaceExposure.create({
                data: {
                  ...event,
                  id: rankId,
                  receivedAt: now,
                  expiresAt: row.expiresAt,
                },
              })
            exported.push({
              ...event,
              rankId,
              receivedAt: now,
              expiresAt: row.expiresAt,
              duplicateCount: 0,
              revision: 1,
            })
          }
          const firstSeen = new Set<string>()
          const replayCounts = new Map<string, number>()
          const result: WatchSurfaceExposureReceipt[] = []
          for (const event of events) {
            const row = existingById.get(event.eventId)!
            let status: WatchSurfaceExposureReceipt["status"]
            if (row.exactDigest !== watchExactDigest(event)) status = "conflict"
            else if (
              !firstSeen.has(event.eventId) &&
              inserted.has(event.eventId)
            ) {
              const earlier = await tx.watchSurfaceEventReceipt.findFirst({
                where: {
                  windowId: event.windowId,
                  groupDigest: row.groupDigest,
                  OR: [
                    { occurredAt: { lt: row.occurredAt } },
                    {
                      occurredAt: row.occurredAt,
                      receivedAt: { lt: row.receivedAt },
                    },
                    {
                      occurredAt: row.occurredAt,
                      receivedAt: row.receivedAt,
                      rankId: { lt: row.rankId },
                    },
                  ],
                },
                select: { eventId: true },
              })
              const legacyEarlier = await tx.watchSurfaceExposure.findFirst({
                where: {
                  windowId: event.windowId,
                  surface: event.surface,
                  block: event.block,
                  presentation: event.presentation,
                  placement: event.placement,
                  policyVersion: event.policyVersion,
                  position: event.position,
                  itemPath: event.itemPath,
                  kind: event.kind,
                  OR: [
                    { occurredAt: { lt: row.occurredAt } },
                    {
                      occurredAt: row.occurredAt,
                      receivedAt: { lt: row.receivedAt },
                    },
                    {
                      occurredAt: row.occurredAt,
                      receivedAt: row.receivedAt,
                      id: { lt: row.rankId },
                    },
                  ],
                },
                select: { eventId: true },
              })
              status = earlier || legacyEarlier ? "repeat" : "accepted"
            } else {
              status = "replay"
              replayCounts.set(
                event.eventId,
                (replayCounts.get(event.eventId) ?? 0) + 1,
              )
            }
            firstSeen.add(event.eventId)
            result.push({ eventId: event.eventId, status })
          }
          for (const [eventId, count] of replayCounts) {
            const row = await tx.watchSurfaceEventReceipt.update({
              where: { eventId },
              data: {
                duplicateCount: { increment: count },
                revision: { increment: 1 },
              },
            })
            if (watchAdmissionMode() === "shadow")
              await tx.watchSurfaceExposure.update({
                where: { eventId },
                data: { duplicateCount: { increment: count } },
              })
            const event = unique.get(eventId)!
            exported.push({
              ...event,
              rankId: row.rankId,
              receivedAt: row.receivedAt,
              expiresAt: row.expiresAt,
              duplicateCount: row.duplicateCount,
              revision: row.revision,
            })
          }
          return result
        },
        { timeout: 4000, maxWait: 3000 },
      )
      dispatchWatchFacts(exported, now)
      return receipts
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        continue
      throw error
    }
  }
  throw new RecommendationInputError("Watch exposure collision")
}

export async function recordWatchSurfaceExposure(
  prisma: PrismaClient,
  caller: Principal | null,
  raw: unknown,
  now = new Date(),
): Promise<WatchSurfaceExposureReceipt> {
  if (watchAdmissionMode() !== "legacy")
    return (
      await recordWatchSurfaceExposureBatch(prisma, caller, [raw], now)
    )[0]
  assertWebRecommendationCaller(caller)
  const event = parseEvent(raw, now)
  const issuedExpiries = await assertIssuedEvents(prisma, [event], now)
  const occurredAt = event.occurredAt
  const existingById = await prisma.watchSurfaceExposure.findUnique({
    where: { eventId: event.eventId },
  })
  if (existingById) {
    if (!sameEvent(existingById, event))
      return { eventId: event.eventId, status: "conflict" }
    await prisma.watchSurfaceExposure.update({
      where: { eventId: event.eventId },
      data: { duplicateCount: { increment: 1 } },
    })
    return { eventId: event.eventId, status: "replay" }
  }
  const prior = await prisma.watchSurfaceExposure.findFirst({
    where: {
      windowId: event.windowId,
      surface: event.surface,
      block: event.block,
      presentation: event.presentation,
      placement: event.placement,
      policyVersion: event.policyVersion,
      position: event.position,
      itemPath: event.itemPath,
      kind: event.kind,
    },
    select: { id: true },
  })
  try {
    await prisma.watchSurfaceExposure.create({
      data: {
        ...event,
        occurredAt,
        expiresAt:
          issuedExpiries.get(event.eventId) ??
          new Date(now.getTime() + WATCH_SURFACE_EXPOSURE_RETENTION_MS),
      },
    })
    return { eventId: event.eventId, status: prior ? "repeat" : "accepted" }
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error
    }
  }
  const raced = await prisma.watchSurfaceExposure.findUnique({
    where: { eventId: event.eventId },
  })
  if (!raced) throw new RecommendationInputError("Watch exposure collision")
  if (sameEvent(raced, event)) {
    await prisma.watchSurfaceExposure.update({
      where: { eventId: event.eventId },
      data: { duplicateCount: { increment: 1 } },
    })
    return { eventId: event.eventId, status: "replay" }
  }
  return { eventId: event.eventId, status: "conflict" }
}
