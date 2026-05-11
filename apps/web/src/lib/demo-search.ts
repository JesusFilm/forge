import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/graphql"
import client from "@/lib/client"

// Minimal fetch for the /demo-search watch page. Intentionally decoupled from
// lib/content.ts's richer ResolvedWatchPage tree so the demo route does not
// drag along the template-experience lookup path.

const GET_DEMO_VIDEO = adminGraphql(`
  query GetDemoVideo($slug: String!, $locale: String!) {
    videoBySlug(slug: $slug, locale: $locale) {
      id
      slug
      locales(locale: $locale) {
        title
        description
      }
      images {
        url
        mobileCinematicHigh
      }
      primaryLanguage {
        coreId
      }
      dubs {
        id
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
  AdminResultOf<typeof GET_DEMO_VIDEO>["videoBySlug"]
>

export type DemoPlayableVideo = {
  title: string
  description: string | null
  streamingUrl: string | null
  posterUrl: string | null
  imageUrl: string | null
}

function selectPlayableVariant(video: NonNullable<DemoVideoRecord>) {
  const dubs = video.dubs ?? []
  const playable = dubs.filter(
    (dub) => dub.published === true && Boolean(dub.hls),
  )
  if (!playable.length) return null

  const primaryLanguageId = video.primaryLanguage?.coreId ?? null
  if (primaryLanguageId) {
    const primary = playable.find(
      (dub) => dub.language?.coreId === primaryLanguageId,
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
      const record = result.data?.videoBySlug as DemoVideoRecord | undefined
      if (!record) return null

      const variant = selectPlayableVariant(record)
      const image = record.images?.[0]
      const imageUrl =
        (image?.mobileCinematicHigh as string | undefined) ?? image?.url ?? null
      const localeContent = record.locales?.[0]

      return {
        title: localeContent?.title ?? slug,
        description: localeContent?.description ?? null,
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
