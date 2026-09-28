import { randomUUID } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import type { Principal } from "@/auth/principal"
import { assertWebRecommendationCaller } from "./caller"
import { RecommendationInputError } from "./errors"
import { registeredAnonymousWatchSurface } from "./watch-surface-registry"

const Event = z
  .object({
    eventId: z.string().uuid(),
    windowId: z.string().uuid(),
    surface: z.string().min(1).max(40),
    block: z.string().min(1).max(40),
    presentation: z.string().min(1).max(40),
    placement: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    policyVersion: z.literal("watch-exposure-v1"),
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
  const unique = new Map<string, ParsedEvent>()
  for (const event of events) {
    if (!unique.has(event.eventId)) unique.set(event.eventId, event)
  }
  const inserted = await prisma.watchSurfaceExposure.createManyAndReturn({
    data: [...unique.values()].map((event) => ({
      id: randomUUID(),
      ...event,
      expiresAt: new Date(now.getTime() + 29 * 86_400_000),
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
        expiresAt: new Date(now.getTime() + 29 * 86_400_000),
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
