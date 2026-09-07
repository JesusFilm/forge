import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import type { TypesenseCurationSet } from "./typesense-client"
import { canonicalTypesenseVideoId } from "./typesense-watch-search-identifiers"
import {
  typesenseWatchLocaleCodes,
  type TypesenseWatchLexicalDocument,
} from "./typesense-watch-search-lexical"
import { normalizeWatchSearchCurationQuery } from "./watch-search-curation"

export { normalizeWatchSearchCurationQuery } from "./watch-search-curation"

export const TYPESENSE_WATCH_SEARCH_CURATION_TAG = "watch-search-editorial"

export type WatchSearchCurationScope = "PUBLISHED_LOCALES" | "ALL_LANGUAGES"

export type WatchSearchCurationAliasProjection = {
  id: string
  query: string
  normalizedQuery: string
  locale: string | null
  active: boolean
}

export type WatchSearchCurationProjection = {
  id: string
  targetVideoCoreId: string
  scope: WatchSearchCurationScope
  position: number
  enabled: boolean
  aliases: readonly WatchSearchCurationAliasProjection[]
}

export class WatchSearchCurationProjectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchCurationProjectionError"
  }
}

export async function loadWatchSearchCurations(
  prisma: PrismaClient,
): Promise<WatchSearchCurationProjection[]> {
  return prisma.watchSearchCuration.findMany({
    where: { enabled: true },
    orderBy: { id: "asc" },
    select: {
      id: true,
      targetVideoCoreId: true,
      scope: true,
      position: true,
      enabled: true,
      aliases: {
        where: { active: true },
        orderBy: { id: "asc" },
        select: {
          id: true,
          query: true,
          normalizedQuery: true,
          locale: true,
          active: true,
        },
      },
    },
  })
}

function curationItemId(query: string): string {
  return `query-${createHash("sha256").update(query).digest("hex").slice(0, 16)}`
}

export function buildTypesenseWatchCurationProjection({
  setName,
  curations,
  lexicalDocuments,
}: {
  setName: string
  curations: readonly WatchSearchCurationProjection[]
  lexicalDocuments: readonly TypesenseWatchLexicalDocument[]
}) {
  type QueryGroup = {
    query: string
    includes: Map<string, number>
  }

  const queryGroups = new Map<string, QueryGroup>()
  const coverage: Array<{
    curationId: string
    publishedDocumentIds: string[]
    skippedAliasIds: string[]
  }> = []

  for (const curation of curations.filter(({ enabled }) => enabled)) {
    if (curation.scope !== "PUBLISHED_LOCALES") {
      throw new WatchSearchCurationProjectionError(
        `Watch Search curation ${curation.id} uses unsupported scope ${curation.scope}`,
      )
    }
    if (!Number.isInteger(curation.position) || curation.position <= 0) {
      throw new WatchSearchCurationProjectionError(
        `Watch Search curation ${curation.id} position must be a positive integer`,
      )
    }

    const canonicalVideoId = canonicalTypesenseVideoId(
      "curated-video",
      curation.targetVideoCoreId,
    )
    const publishedDocuments = lexicalDocuments
      .filter((document) => document.canonicalVideoId === canonicalVideoId)
      .sort((left, right) => left.id.localeCompare(right.id))
    if (publishedDocuments.length === 0) {
      throw new WatchSearchCurationProjectionError(
        `Watch Search curation ${curation.id} has no published searchable target documents`,
      )
    }
    const skippedAliasIds: string[] = []

    for (const alias of curation.aliases.filter(({ active }) => active)) {
      const normalizedQuery = normalizeWatchSearchCurationQuery(alias.query)
      if (!normalizedQuery || alias.normalizedQuery !== normalizedQuery) {
        throw new WatchSearchCurationProjectionError(
          `Watch Search curation alias ${alias.id} has stale normalized query`,
        )
      }
      const eligibleDocuments = alias.locale
        ? (() => {
            const [locale] = typesenseWatchLocaleCodes(alias.locale)
            if (!locale) {
              throw new WatchSearchCurationProjectionError(
                `Watch Search curation alias ${alias.id} has an invalid locale`,
              )
            }
            return publishedDocuments.filter((document) =>
              document.localeCodes.includes(locale),
            )
          })()
        : publishedDocuments
      if (eligibleDocuments.length === 0) {
        skippedAliasIds.push(alias.id)
        continue
      }

      const group = queryGroups.get(normalizedQuery) ?? {
        query: normalizedQuery,
        includes: new Map<string, number>(),
      }
      for (const [index, document] of eligibleDocuments.entries()) {
        const position = curation.position + index
        const previousPosition = group.includes.get(document.id)
        group.includes.set(
          document.id,
          previousPosition == null
            ? position
            : Math.min(previousPosition, position),
        )
      }
      queryGroups.set(normalizedQuery, group)
    }

    coverage.push({
      curationId: curation.id,
      publishedDocumentIds: publishedDocuments.map(({ id }) => id),
      skippedAliasIds,
    })
  }

  const items = [...queryGroups.values()]
    .sort((left, right) => left.query.localeCompare(right.query))
    .map(({ query, includes }) => ({
      id: curationItemId(query),
      rule: {
        query,
        match: "exact" as const,
        tags: [TYPESENSE_WATCH_SEARCH_CURATION_TAG],
      },
      includes: [...includes]
        .sort(([leftId, leftPosition], [rightId, rightPosition]) =>
          leftPosition === rightPosition
            ? leftId.localeCompare(rightId)
            : leftPosition - rightPosition,
        )
        .reduce<Array<{ id: string; position: number }>>(
          (resolved, [id, requestedPosition]) => {
            const previousPosition = resolved.at(-1)?.position ?? 0
            resolved.push({
              id,
              position: Math.max(requestedPosition, previousPosition + 1),
            })
            return resolved
          },
          [],
        ),
      filter_curated_hits: true as const,
      remove_matched_tokens: false as const,
    }))

  return {
    name: setName,
    set: { items } satisfies TypesenseCurationSet,
    coverage,
  }
}
