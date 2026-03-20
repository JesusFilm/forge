import type { Core } from "@strapi/strapi"
import { queryGateway } from "./gateway-client"
import {
  type SyncStats,
  formatError,
  upsertByGatewayId,
  softDeleteUnseen,
  buildGatewayIdMap,
} from "./strapi-helpers"
import type { SyncKeywordsQuery } from "../gql/gateway-types"

const KEYWORDS_QUERY = /* GraphQL */ `
  query SyncKeywords {
    keywords {
      id
      value
      language {
        id
      }
    }
  }
`

type GatewayKeyword = SyncKeywordsQuery["keywords"][number]

export async function syncKeywords(strapi: Core.Strapi): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  strapi.log.info("[gateway-sync] Starting keyword sync")

  const data = await queryGateway<SyncKeywordsQuery>(KEYWORDS_QUERY)
  const keywords = data.keywords

  if (keywords.length === 0) {
    strapi.log.error(
      "[gateway-sync] Gateway returned 0 keywords — circuit breaker: skipping sync",
    )
    return stats
  }

  strapi.log.info(
    `[gateway-sync] Fetched ${keywords.length} keywords from gateway`,
  )

  // Pre-load language map to avoid N+1 lookups
  const languageMap = await buildGatewayIdMap(
    strapi,
    "api::language.language",
    "en",
  )

  const seenIds = new Set<string>()

  for (const kw of keywords) {
    seenIds.add(kw.id)

    try {
      const langDocId = languageMap.get(kw.language.id)

      const { action } = await upsertByGatewayId(
        strapi,
        "api::keyword.keyword",
        kw.id,
        {
          value: kw.value,
          language: langDocId ?? undefined,
        },
      )

      if (action === "created") stats.created++
      else if (action === "updated") stats.updated++
    } catch (error) {
      stats.errors++
      strapi.log.warn(
        `[gateway-sync] Failed to upsert keyword ${kw.id}: ${formatError(error)}`,
      )
    }
  }

  stats.softDeleted = await softDeleteUnseen(
    strapi,
    "api::keyword.keyword",
    seenIds,
  )

  strapi.log.info(
    `[gateway-sync] Keyword sync complete: ${stats.created} created, ${stats.updated} updated, ${stats.softDeleted} soft-deleted, ${stats.errors} errors`,
  )

  return stats
}
