import type { Core } from "@strapi/strapi"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  formatError,
  upsertByCoreId,
  softDeleteUnseen,
  buildCoreIdMap,
  clearableRelation,
} from "./strapi-helpers"

const KEYWORDS_QUERY = graphql(/* GraphQL */ `
  query SyncKeywords {
    keywords {
      id
      value
      language {
        id
      }
    }
  }
`)

export async function syncKeywords(
  strapi: Core.Strapi,
  progress: ProgressReporter,
): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  strapi.log.info("[core-sync] Starting keyword sync")

  const { data } = await getCoreClient().query({ query: KEYWORDS_QUERY })
  const keywords = data.keywords

  if (keywords.length === 0) {
    strapi.log.error(
      "[core-sync] Core API returned 0 keywords — circuit breaker: skipping sync",
    )
    return stats
  }

  strapi.log.info(`[core-sync] Fetched ${keywords.length} keywords from core`)

  progress.setTotal(keywords.length)

  // Pre-load language map to avoid N+1 lookups
  const languageMap = await buildCoreIdMap(
    strapi,
    "api::language.language",
    "en",
  )

  const seenIds = new Set<string>()

  for (const kw of keywords) {
    seenIds.add(kw.id)

    try {
      const langDocId = languageMap.get(kw.language.id)

      const { action } = await upsertByCoreId(
        strapi,
        "api::keyword.keyword",
        kw.id,
        {
          value: kw.value,
          language: clearableRelation(langDocId),
        },
      )

      if (action === "created") stats.created++
      else if (action === "updated") stats.updated++
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[core-sync] Failed to upsert keyword ${kw.id}: ${formatError(error)}`,
      )
    }

    progress.increment()
  }

  stats.softDeleted = await softDeleteUnseen(
    strapi,
    "api::keyword.keyword",
    seenIds,
  )

  strapi.log.info(
    `[core-sync] Keyword sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors`,
  )

  return stats
}
