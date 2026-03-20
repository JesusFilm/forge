import type { Core } from "@strapi/strapi"
import type { ResultOf } from "@graphql-typed-document-node/core"
import { getGatewayClient } from "./gateway-client"
import { graphql } from "../gql"
import {
  type SyncStats,
  formatError,
  upsertByGatewayId,
  softDeleteUnseen,
  buildGatewayIdMap,
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

type GatewayKeyword = ResultOf<typeof KEYWORDS_QUERY>["keywords"][number]

export async function syncKeywords(strapi: Core.Strapi): Promise<SyncStats> {
  const stats: SyncStats = {
    created: 0,
    updated: 0,
    softDeleted: 0,
    errors: 0,
  }

  strapi.log.info("[gateway-sync] Starting keyword sync")

  const { data } = await getGatewayClient().query({ query: KEYWORDS_QUERY })
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
          language: clearableRelation(langDocId),
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
