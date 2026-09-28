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

type StoredEvent = ParsedEvent & { repeated: boolean }

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
    id: randomUUID(),
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
    expiresAt: new Date(now.getTime() + 29 * 86_400_000),
  }))
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
  prisma: PrismaClient,
  events: ParsedEvent[],
  now: Date,
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
    if (!binding)
      throw new RecommendationInputError(
        "Watch exposure has no issued served binding",
      )
    expiries.set(event.eventId, binding.expiresAt)
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
  const issuedExpiries = await assertIssuedEvents(prisma, events, now)
  const unique = new Map<string, ParsedEvent>()
  for (const event of events) {
    if (!unique.has(event.eventId)) unique.set(event.eventId, event)
  }
  const inserted = await prisma.watchSurfaceExposure.createManyAndReturn({
    data: [...unique.values()].map((event) => ({
      id: randomUUID(),
      ...event,
      expiresAt:
        issuedExpiries.get(event.eventId) ??
        new Date(now.getTime() + 29 * 86_400_000),
    })),
    skipDuplicates: true,
    select: { eventId: true },
  })
  const insertedIds = new Set(inserted.map(({ eventId }) => eventId))
  const ids = [...unique.keys()]
  const stored = await prisma.$queryRaw<StoredEvent[]>`
    SELECT e.event_id AS "eventId", e.window_id AS "windowId",
           e.surface, e.block, e.presentation, e.placement,
           e.policy_version AS "policyVersion", e.position,
           e.item_path AS "itemPath", e.kind,
           e.visibility_capability AS "visibilityCapability",
           e.occurred_at AS "occurredAt",
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
  const storedById = new Map(stored.map((event) => [event.eventId, event]))
  const firstSeen = new Set<string>()
  const replayCounts = new Map<string, number>()
  const receipts = events.map((event): WatchSurfaceExposureReceipt => {
    const row = storedById.get(event.eventId)
    if (!row) throw new RecommendationInputError("Watch exposure write missing")
    const first = !firstSeen.has(event.eventId)
    firstSeen.add(event.eventId)
    let status: WatchSurfaceExposureReceipt["status"]
    if (!sameEvent(row, event)) {
      status = "conflict"
    } else if (first && insertedIds.has(event.eventId)) {
      status = row.repeated ? "repeat" : "accepted"
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
  return receipts
}

export async function recordWatchSurfaceExposure(
  prisma: PrismaClient,
  caller: Principal | null,
  raw: unknown,
  now = new Date(),
): Promise<WatchSurfaceExposureReceipt> {
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
        id: randomUUID(),
        ...event,
        occurredAt,
        expiresAt:
          issuedExpiries.get(event.eventId) ??
          new Date(now.getTime() + 29 * 86_400_000),
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
