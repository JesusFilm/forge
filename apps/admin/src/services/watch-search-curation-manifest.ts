import type { PrismaClient } from "@prisma/client"

export const WATCH_SEARCH_CURATION_MANIFEST_SCHEMA_VERSION =
  "watch-search-curations/v1" as const

type ManifestAliasRow = {
  id: string
  query: string
  normalizedQuery: string
  locale: string | null
  source: "EDITORIAL" | "MACHINE"
  translationModel: string | null
  sourceTextDigest: string | null
  generatedAt: Date | null
  active: boolean
}

export type WatchSearchCurationManifestRow = {
  id: string
  key: string
  targetVideoCoreId: string
  scope: "PUBLISHED_LOCALES" | "ALL_LANGUAGES"
  position: number
  enabled: boolean
  aliases: ManifestAliasRow[]
}

export type WatchSearchCurationManifest = {
  schemaVersion: typeof WATCH_SEARCH_CURATION_MANIFEST_SCHEMA_VERSION
  curations: Array<
    Omit<WatchSearchCurationManifestRow, "aliases"> & {
      aliases: Array<
        Omit<ManifestAliasRow, "generatedAt"> & {
          generatedAt: string | null
        }
      >
    }
  >
}

export async function loadWatchSearchCurationManifest(
  prisma: PrismaClient,
): Promise<WatchSearchCurationManifest> {
  const rows = await prisma.watchSearchCuration.findMany({
    orderBy: [{ key: "asc" }, { id: "asc" }],
    select: {
      id: true,
      key: true,
      targetVideoCoreId: true,
      scope: true,
      position: true,
      enabled: true,
      aliases: {
        orderBy: [{ locale: "asc" }, { normalizedQuery: "asc" }, { id: "asc" }],
        select: {
          id: true,
          query: true,
          normalizedQuery: true,
          locale: true,
          source: true,
          translationModel: true,
          sourceTextDigest: true,
          generatedAt: true,
          active: true,
        },
      },
    },
  })
  return buildWatchSearchCurationManifest(rows)
}

export function buildWatchSearchCurationManifest(
  rows: readonly WatchSearchCurationManifestRow[],
): WatchSearchCurationManifest {
  const compare = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0
  return {
    schemaVersion: WATCH_SEARCH_CURATION_MANIFEST_SCHEMA_VERSION,
    curations: [...rows]
      .sort(
        (left, right) =>
          compare(left.key, right.key) || compare(left.id, right.id),
      )
      .map((row) => ({
        ...row,
        aliases: [...row.aliases]
          .sort(
            (left, right) =>
              compare(left.locale ?? "", right.locale ?? "") ||
              compare(left.normalizedQuery, right.normalizedQuery) ||
              compare(left.id, right.id),
          )
          .map((alias) => ({
            ...alias,
            generatedAt: alias.generatedAt?.toISOString() ?? null,
          })),
      })),
  }
}

export function serializeWatchSearchCurationManifest(
  manifest: WatchSearchCurationManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
