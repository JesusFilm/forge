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
  const receipts: WatchSurfaceExposureReceipt[] = []
  for (const event of raw) {
    receipts.push(await recordWatchSurfaceExposure(prisma, caller, event, now))
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
  const existingById = await prisma.watchSurfaceExposure.findUnique({
    where: { eventId: event.eventId },
  })
  if (existingById) {
    const same =
      existingById.windowId === event.windowId &&
      existingById.surface === event.surface &&
      existingById.block === event.block &&
      existingById.presentation === event.presentation &&
      existingById.placement === event.placement &&
      existingById.position === event.position &&
      existingById.itemPath === event.itemPath &&
      existingById.kind === event.kind &&
      existingById.visibilityCapability === event.visibilityCapability &&
      existingById.occurredAt.getTime() === occurredAt.getTime()
    if (!same) return { eventId: event.eventId, status: "conflict" }
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
  if (
    raced.windowId === event.windowId &&
    raced.surface === event.surface &&
    raced.block === event.block &&
    raced.presentation === event.presentation &&
    raced.placement === event.placement &&
    raced.position === event.position &&
    raced.itemPath === event.itemPath &&
    raced.kind === event.kind &&
    raced.visibilityCapability === event.visibilityCapability &&
    raced.occurredAt.getTime() === occurredAt.getTime()
  ) {
    await prisma.watchSurfaceExposure.update({
      where: { eventId: event.eventId },
      data: { duplicateCount: { increment: 1 } },
    })
    return { eventId: event.eventId, status: "replay" }
  }
  return { eventId: event.eventId, status: "conflict" }
}
