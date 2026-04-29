import { unstable_cache } from "next/cache"
import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"

// Minimal fetch for the /demo-search watch page. Intentionally decoupled from
// lib/content.ts's richer ResolvedWatchPage tree so the demo route does not
// drag along the template-experience lookup path.

const GET_DEMO_VIDEO = graphql(`
  query GetDemoVideo($slug: String!, $locale: I18NLocaleCode!) {
    videos(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
      slug
      title
      description
      images {
        url
        mobileCinematicHigh
      }
      primaryLanguage {
        coreId
      }
      variants {
        documentId
        hls
        published
        language {
          coreId
        }
      }
    }
  }
`)

type DemoVideoRecord = NonNullable<
  ResultOf<typeof GET_DEMO_VIDEO>["videos"]
>[number]

export type DemoPlayableVideo = {
  title: string
  description: string | null
  streamingUrl: string | null
  posterUrl: string | null
  imageUrl: string | null
}

function selectPlayableVariant(video: NonNullable<DemoVideoRecord>) {
  const variants = (video.variants ?? []).filter(
    (variant): variant is NonNullable<typeof variant> => variant != null,
  )
  const playable = variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )
  if (!playable.length) return null

  const primaryLanguageId = video.primaryLanguage?.coreId ?? null
  if (primaryLanguageId) {
    const primary = playable.find(
      (variant) => variant.language?.coreId === primaryLanguageId,
    )
    if (primary) return primary
  }
  return playable[0] ?? null
}

const fetchDemoVideo = unstable_cache(
  async (slug: string, locale: string): Promise<DemoPlayableVideo | null> => {
    try {
      const result = await client.query({
        query: GET_DEMO_VIDEO,
        variables: { slug, locale },
        fetchPolicy: "no-cache",
      })
      const record = result.data?.videos?.[0] as
        | NonNullable<DemoVideoRecord>
        | undefined
      if (!record) return null

      const variant = selectPlayableVariant(record)
      const image = record.images?.[0]
      const imageUrl =
        (image?.mobileCinematicHigh as string | undefined) ?? image?.url ?? null

      return {
        title: record.title ?? slug,
        description: record.description ?? null,
        streamingUrl: variant?.hls ?? null,
        posterUrl: imageUrl,
        imageUrl,
      }
    } catch (err) {
      // Distinguish a genuinely missing video from a transient CMS failure
      // in the logs so silent degradation is visible to operators. The page
      // still falls back to the live-site link either way.
      console.error(
        `[demo-search] getDemoPlayableVideo(${slug}/${locale}) failed`,
        err instanceof Error ? err.message : err,
      )
      return null
    }
  },
  ["demo-search-video"],
  { revalidate: 60 },
)

// The outer React `cache()` wrapper was redundant — `unstable_cache` already
// memoizes by key. Keeping just the one layer so the cache story is easy to
// reason about during incident debugging.
export const getDemoPlayableVideo = fetchDemoVideo
