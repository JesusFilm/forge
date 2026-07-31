// Sync watermark — tracks per-phase last-synced time.
//
// Watermark is advanced ONLY when a phase completes with zero errors.
// The watermark value is the fetch-start time (captured BEFORE issuing
// the Core query), NOT the completion time — this ensures records that
// Core updated during the sync run are picked up on the next pass.

import type { Prisma, PrismaClient } from "@prisma/client"
import type { SyncPhase, SyncStats } from "./types"

type SyncStateWriter =
  | Pick<PrismaClient, "syncState">
  | Pick<Prisma.TransactionClient, "syncState">

export async function getWatermark(
  prisma: PrismaClient,
  phase: SyncPhase,
): Promise<string | null> {
  const row = await prisma.syncState.findUnique({ where: { phase } })
  return row?.lastSyncedAt?.toISOString() ?? null
}

export async function advanceWatermark(
  prisma: SyncStateWriter,
  phase: SyncPhase,
  fetchStartedAt: string,
  stats: SyncStats,
): Promise<void> {
  await prisma.syncState.upsert({
    where: { phase },
    create: {
      phase,
      lastSyncedAt: new Date(fetchStartedAt),
      stats: JSON.parse(JSON.stringify(stats)),
    },
    update: {
      lastSyncedAt: new Date(fetchStartedAt),
      stats: JSON.parse(JSON.stringify(stats)),
    },
  })
}

export async function updateStatsOnly(
  prisma: SyncStateWriter,
  phase: SyncPhase,
  stats: SyncStats,
): Promise<void> {
  await prisma.syncState.upsert({
    where: { phase },
    create: {
      phase,
      lastSyncedAt: new Date(0),
      stats: JSON.parse(JSON.stringify(stats)),
    },
    update: {
      stats: JSON.parse(JSON.stringify(stats)),
    },
  })
}

export async function getAllWatermarks(
  prisma: PrismaClient,
): Promise<Array<{ phase: string; lastSyncedAt: string; stats: unknown }>> {
  const rows = await prisma.syncState.findMany({
    orderBy: { lastSyncedAt: "desc" },
  })
  return rows.map((r) => ({
    phase: r.phase,
    lastSyncedAt: r.lastSyncedAt.toISOString(),
    stats: r.stats,
  }))
}
