import type { PrismaClient } from "@prisma/client"
import { encodeWatchHistoryFact } from "./watch-event-history"

export type WatchHistoryBackfillCursor = { expiresAt: Date; id: string }

/** Bounded read for feat-895's checkpointed migration; never renews expiry. */
export async function readUnexpiredWatchHistoryPage(
  prisma: PrismaClient,
  now: Date,
  cursor?: WatchHistoryBackfillCursor,
  limit = 256,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 256)
    throw new RangeError("Watch backfill page limit must be 1..256")
  const rows = await prisma.watchSurfaceExposure.findMany({
    where: {
      expiresAt: { gt: now },
      ...(cursor && {
        OR: [
          { expiresAt: { gt: cursor.expiresAt } },
          { expiresAt: cursor.expiresAt, id: { gt: cursor.id } },
        ],
      }),
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: limit,
  })
  return {
    events: rows.map((row) =>
      encodeWatchHistoryFact(
        {
          eventId: row.eventId,
          rankId: row.id,
          windowId: row.windowId,
          surface: row.surface,
          block: row.block,
          presentation: row.presentation,
          placement: row.placement,
          policyVersion: row.policyVersion,
          position: row.position,
          itemPath: row.itemPath,
          kind: row.kind,
          visibilityCapability: row.visibilityCapability,
          occurredAt: row.occurredAt,
          receivedAt: row.receivedAt,
          expiresAt: row.expiresAt,
          duplicateCount: row.duplicateCount,
          // Legacy duplicate_count is the only durable correction sequence.
          revision: row.duplicateCount + 1,
        },
        row.duplicateCount > 0 ? now : row.receivedAt,
      ),
    ),
    nextCursor:
      rows.length === limit
        ? {
            expiresAt: rows[rows.length - 1].expiresAt,
            id: rows[rows.length - 1].id,
          }
        : null,
  }
}
