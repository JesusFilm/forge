// Per-request DataLoader instances.
//
// DataLoader batches and dedupes calls within a single request tick. The
// Pothos Prisma plugin's `...query` passthrough already covers nested
// relation loads (verified in the Unit 3 spike). DataLoaders here are the
// escape hatch for service-owned fetches that don't go through Pothos —
// e.g., a service that returns IDs from raw SQL (vector search) and needs
// to hydrate by id, or a parity-test path that compares direct vs nested
// access.
//
// Loaders MUST be per-request — a fresh instance for every GraphQL
// operation. Caching across requests would leak data between principals.
// `createLoaders` is called by `createContext` (Unit 6c) once per request.
//
// Per Unit 6 of docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

import DataLoader from "dataloader"
import type { PrismaClient } from "@prisma/client"

export type Loaders = ReturnType<typeof createLoaders>

export function createLoaders(prisma: PrismaClient) {
  return {
    /** Hydrate Experience rows by id. Used by search / parity test paths. */
    experienceById: new DataLoader<string, ExperienceRow | null>(
      async (ids) => {
        const rows = await prisma.experience.findMany({
          where: { id: { in: ids as string[] } },
        })
        return mapToInputOrder(ids, rows, (r) => r.id)
      },
    ),

    /** Hydrate ExperienceLocale rows by id. */
    experienceLocaleById: new DataLoader<string, ExperienceLocaleRow | null>(
      async (ids) => {
        const rows = await prisma.experienceLocale.findMany({
          where: { id: { in: ids as string[] } },
        })
        return mapToInputOrder(ids, rows, (r) => r.id)
      },
    ),

    /** Hydrate Video rows by id. */
    videoById: new DataLoader<string, VideoRow | null>(async (ids) => {
      const rows = await prisma.video.findMany({
        where: { id: { in: ids as string[] } },
      })
      return mapToInputOrder(ids, rows, (r) => r.id)
    }),

    /** Hydrate Language rows by id. */
    languageById: new DataLoader<string, LanguageRow | null>(async (ids) => {
      const rows = await prisma.language.findMany({
        where: { id: { in: ids as string[] } },
      })
      return mapToInputOrder(ids, rows, (r) => r.id)
    }),

    /**
     * Primary-playable-dub duration (seconds) per Video id, for the
     * `Video.durationSeconds` field resolver. Batches across a single
     * request tick so a watch/series payload projecting
     * `children { child { durationSeconds } }` for a 61-chapter
     * collection resolves all of them in ONE query instead of 61.
     *
     * Semantics mirror `hydrateCardPillFields` in
     * `services/hybrid-search.service.ts`: prefer the primary-language
     * playable dub, else the longest-duration playable dub. Playable =
     * published + has HLS + not soft-deleted + duration > 0 (the last
     * excludes Core sync-glitch rows that report duration 0). Returns
     * null when no playable dub exists (e.g. a SERIES/COLLECTION whose
     * runtime lives on its children).
     */
    videoPrimaryDubDurationById: new DataLoader<string, number | null>(
      async (ids) => {
        const rows = await prisma.video.findMany({
          where: { id: { in: ids as string[] }, deletedAt: null },
          select: {
            id: true,
            primaryLanguageId: true,
            dubs: {
              where: {
                published: true,
                hls: { not: null },
                deletedAt: null,
                duration: { gt: 0 },
              },
              orderBy: [{ duration: "desc" }],
              take: PRIMARY_DUB_DURATION_SCAN_LIMIT,
              select: { languageId: true, duration: true },
            },
          },
        })
        const byId = new Map<string, number | null>()
        for (const row of rows) {
          const primaryDub = row.primaryLanguageId
            ? row.dubs.find((d) => d.languageId === row.primaryLanguageId)
            : undefined
          const dub = primaryDub ?? row.dubs[0] ?? null
          byId.set(row.id, dub?.duration ?? null)
        }
        return ids.map((id) => byId.get(id) ?? null)
      },
    ),
  }
}

// Bounds the per-video dubs scan in `videoPrimaryDubDurationById`. Matches
// `HYDRATION_DUBS_PER_VIDEO` in hybrid-search: order by duration desc and
// take the top N, then prefer the primary-language dub among them. On a
// heavily-dubbed video the primary may rank below N by duration — accept
// the longest-dub fallback rather than widen the scan.
const PRIMARY_DUB_DURATION_SCAN_LIMIT = 5

// Inferring per-row shapes from prisma without importing each model
// type lets us avoid a hand-maintained type per loader. PrismaClient's
// findMany return type is the source of truth.
type ExperienceRow = Awaited<
  ReturnType<PrismaClient["experience"]["findMany"]>
>[number]
type ExperienceLocaleRow = Awaited<
  ReturnType<PrismaClient["experienceLocale"]["findMany"]>
>[number]
type VideoRow = Awaited<ReturnType<PrismaClient["video"]["findMany"]>>[number]
type LanguageRow = Awaited<
  ReturnType<PrismaClient["language"]["findMany"]>
>[number]

/**
 * DataLoader contract: the returned array must align with the input keys
 * and return null for keys with no matching row. `findMany` returns rows
 * in arbitrary order, so we build a map and project into the input order.
 */
function mapToInputOrder<K, R>(
  keys: readonly K[],
  rows: R[],
  rowKey: (r: R) => K,
): Array<R | null> {
  const byKey = new Map<K, R>()
  for (const row of rows) byKey.set(rowKey(row), row)
  return keys.map((k) => byKey.get(k) ?? null)
}
