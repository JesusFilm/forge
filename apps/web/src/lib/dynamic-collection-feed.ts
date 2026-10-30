import "server-only"

import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import adminClient from "@/lib/admin-client"
import type {
  DynamicCollectionFeedPage,
  NormalizedDynamicCollectionFeedInput,
} from "@/lib/dynamic-collection-contract"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"

const GET_WATCH_COLLECTION_FEED = adminGraphql(`
  query GetWatchCollectionFeed(
    $languageSlug: String!
    $locale: String!
    $first: Int!
    $cardsPerParent: Int!
    $after: String
    $excludedIds: [String!]
    $excludedSlugs: [String!]
  ) {
    watchCollectionFeed(
      languageSlug: $languageSlug
      locale: $locale
      first: $first
      cardsPerParent: $cardsPerParent
      after: $after
      excludedIds: $excludedIds
      excludedSlugs: $excludedSlugs
    ) {
      nodes {
        id
        slug
        title
        description
        items {
          id
          coreId
          title
          videoSlug
          languageSlug
          label
          imageUrl
          blurDataUrl
          dominantColor
          muxPlaybackId
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`)

type FeedData = AdminResultOf<typeof GET_WATCH_COLLECTION_FEED>

class DynamicCollectionFeedUpstreamError extends Error {
  constructor() {
    super("The collection feed is unavailable.")
    this.name = "DynamicCollectionFeedUpstreamError"
  }
}

function mapFeed(data: FeedData): DynamicCollectionFeedPage {
  return {
    sections: data.watchCollectionFeed.nodes.map((node) => ({
      id: node.id,
      slug: node.slug,
      title: node.title,
      description: node.description ?? null,
      items: node.items.map((item) => ({
        id: item.id,
        coreId: item.coreId,
        title: item.title,
        videoSlug: item.videoSlug,
        languageSlug: item.languageSlug ?? null,
        label: item.label ?? null,
        imageUrl: item.imageUrl ?? null,
        blurDataUrl: item.blurDataUrl ?? null,
        dominantColor: item.dominantColor ?? null,
        muxPlaybackId: item.muxPlaybackId ?? null,
      })),
    })),
    endCursor: data.watchCollectionFeed.pageInfo.endCursor ?? null,
    hasNextPage: data.watchCollectionFeed.pageInfo.hasNextPage,
  }
}

async function fetchDynamicCollectionFeedPage(
  locale: string,
  languageSlug: string,
  after: string | null,
  excludedIds: string[],
  excludedSlugs: string[],
  first: number,
  cardsPerParent: number,
): Promise<DynamicCollectionFeedPage> {
  const result = await adminClient.query({
    query: GET_WATCH_COLLECTION_FEED,
    variables: {
      locale,
      languageSlug,
      first,
      cardsPerParent,
      after,
      excludedIds,
      excludedSlugs,
    },
    fetchPolicy: "no-cache",
  })

  if (result.error) throw result.error
  if (!result.data?.watchCollectionFeed) {
    throw new DynamicCollectionFeedUpstreamError()
  }

  return mapFeed(result.data)
}

const getCachedDynamicCollectionFeedPage = unstable_cache(
  fetchDynamicCollectionFeedPage,
  ["watch-dynamic-collection-feed-v1"],
  {
    revalidate: 86_400,
    tags: [WATCH_CACHE_TAGS.home, WATCH_CACHE_TAGS.video],
  },
)

const getCachedPreviewDynamicCollectionFeedPage = unstable_cache(
  fetchDynamicCollectionFeedPage,
  ["watch-dynamic-collection-feed-preview-v1"],
  {
    revalidate: 900,
    tags: [WATCH_CACHE_TAGS.home, WATCH_CACHE_TAGS.video],
  },
)

export function getDynamicCollectionFeedPage(
  input: NormalizedDynamicCollectionFeedInput,
  options: { sharedCache: boolean } = { sharedCache: false },
): Promise<DynamicCollectionFeedPage> {
  if (!options.sharedCache) {
    return fetchDynamicCollectionFeedPage(
      input.locale,
      input.languageSlug,
      input.after,
      input.excludedIds,
      input.excludedSlugs,
      input.first,
      input.cardsPerParent,
    )
  }

  const getCachedPage =
    input.cacheScope === "preview"
      ? getCachedPreviewDynamicCollectionFeedPage
      : getCachedDynamicCollectionFeedPage

  return getCachedPage(
    input.locale,
    input.languageSlug,
    input.after,
    input.excludedIds,
    input.excludedSlugs,
    input.first,
    input.cardsPerParent,
  )
}
