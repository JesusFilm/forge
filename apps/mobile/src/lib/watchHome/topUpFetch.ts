// The top-up hydration fetch, extracted from useWatchHome so its chunking +
// fail-fast merge are unit-testable without pulling React into the test.

import { GET_WATCH_HOME_VIDEOS } from "../queries"
import { ENGLISH_LANGUAGE_SLUG, HOME_LOCALE } from "./config"
import type { WatchHomeVideoInput } from "./model"

export type FetchPolicy = "cache-first" | "network-only"

// Type-only reference to the app's Apollo client — erased at runtime, so this
// module stays free of the client's (native-adjacent) import graph.
type TopUpApolloClient = ReturnType<
  typeof import("../apolloClient").getApolloClient
>

// admin's watchHomeVideos caps at 100 coreIds and throws over it — chunk the top-up.
export const VIDEOS_BY_CORE_IDS_MAX = 100

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

// How a top-up attempt resolved: a fulfilled fetch (possibly empty) or a failure
// (timeout / rejected chunk). The hook wraps its try/catch into one of these.
export type TopUpOutcome =
  | { ok: true; videos: readonly WatchHomeVideoInput[] }
  | { ok: false }

/**
 * The last-good hydration decision, pure so the failure→reuse path is unit-tested
 * without driving the hook: on success use the fresh records (and remember them as
 * the next last-good only when non-empty — an empty success must not clobber a good
 * cache); on failure reuse the last-good so a transient blip can't downgrade
 * hydrated cards, reset the hero pager, or poison the snapshot.
 */
export function resolveHydrationVideos(
  outcome: TopUpOutcome,
  lastGood: readonly WatchHomeVideoInput[] | null,
): {
  hydrationVideos: readonly WatchHomeVideoInput[]
  nextLastGood: readonly WatchHomeVideoInput[] | null
} {
  if (outcome.ok) {
    return {
      hydrationVideos: outcome.videos,
      nextLastGood: outcome.videos.length > 0 ? outcome.videos : lastGood,
    }
  }
  return { hydrationVideos: lastGood ?? [], nextLastGood: lastGood }
}

/** Top-up hydration for editor-added coreIds the config pool doesn't cover.
 *  Chunked under the 100-id cap; any rejected chunk rejects the whole top-up so
 *  the caller degrades (drop divergent items, keep the config-pool rows). */
export async function fetchTopUpVideos(
  client: TopUpApolloClient,
  coreIds: readonly string[],
  fetchPolicy: FetchPolicy,
): Promise<WatchHomeVideoInput[]> {
  const batches = await Promise.all(
    chunk(coreIds, VIDEOS_BY_CORE_IDS_MAX).map((ids) =>
      client.query({
        query: GET_WATCH_HOME_VIDEOS,
        variables: {
          coreIds: ids,
          locale: HOME_LOCALE,
          languageSlug: ENGLISH_LANGUAGE_SLUG,
        },
        fetchPolicy,
      }),
    ),
  )
  return batches.flatMap((result) => result.data?.watchHomeVideos ?? [])
}
