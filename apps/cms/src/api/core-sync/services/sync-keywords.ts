import type { Core } from "@strapi/strapi"
import { getCoreClient } from "./core-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  type ProgressReporter,
  softDeleteUnseen,
  buildCoreIdMap,
} from "./strapi-helpers"
import { bulkUpsertByCoreId } from "./bulk-upsert"

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
  _since?: string,
): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  // Keywords API has no updatedAt filter — always full sync
  strapi.log.info("[core-sync] Starting keyword sync (always full)")

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

  // Pre-load language map (coreId → documentId)
  const languageMap = await buildCoreIdMap(
    strapi,
    "api::language.language",
    "en",
  )

  const bulkRecords = keywords.map((kw) => ({
    coreId: kw.id,
    data: { value: kw.value },
    links: {
      keywords_language_lnk: languageMap.get(kw.language.id),
    },
  }))

  const bulkStats = await bulkUpsertByCoreId(
    strapi,
    {
      tableName: "keywords",
      locale: "",
      linkConfigs: [
        {
          linkTable: "keywords_language_lnk",
          sourceColumn: "keyword_id",
          targetTable: "languages",
          targetColumn: "language_id",
          targetLocale: "en",
          orderColumn: "keyword_ord",
        },
      ],
    },
    bulkRecords,
    progress,
  )

  stats.created = bulkStats.created
  stats.updated = bulkStats.updated
  stats.errors = bulkStats.errors

  const seenIds = new Set(keywords.map((kw) => kw.id))
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
