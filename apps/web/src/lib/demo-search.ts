import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"
import { resolveVideoDisplayTitle } from "@forge/content-display"
import client from "@/lib/admin-client"

// Minimal fetch for the /demo-search watch page. Intentionally decoupled from
// lib/content.ts's richer ResolvedWatchPage tree so the demo route does not
// drag along the template-experience lookup path. Admin's `videoBySlug`
// resolves the row by slug only; the locale-narrowed `Video.locales(locale)`
// projection keeps the response to a single locale row even though admin
// stores every locale.

const GET_DEMO_VIDEO = adminGraphql(`
  query GetDemoVideo($slug: String!, $locale: String!) {
    videoBySlug(slug: $slug) {
      documentId: id
      slug
      images {
        url
        mobileCinematicHigh
      }
      primaryLanguage {
        coreId
      }
      locales(locale: $locale) {
        title
        description
      }
      englishTitleLocales: locales(locale: "en") {
        title
      }
      englishLanguageTitleLocales: locales(languageSlug: "english") {
        title
      }
      variants: dubs {
        documentId: id
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

function selectPlayableVariant(video: DemoVideoRecord) {
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
      const record = result.data?.videoBySlug ?? null
      if (!record) return null

      const variant = selectPlayableVariant(record)
      const image = record.images?.[0]
      const imageUrl =
        (image?.mobileCinematicHigh as string | undefined) ?? image?.url ?? null
      const localeRow = record.locales?.[0] ?? null

      return {
        title:
          resolveVideoDisplayTitle({
            requestedTitles: record.locales?.map((locale) => locale.title),
            englishTitles: [
              ...(record.englishTitleLocales?.map((row) => row.title) ?? []),
              ...(record.englishLanguageTitleLocales?.map((row) => row.title) ??
                []),
            ],
            slug: record.slug ?? slug,
          }) ?? "Video",
        description: localeRow?.description ?? null,
        streamingUrl: variant?.hls ?? null,
        posterUrl: imageUrl,
        imageUrl,
      }
    } catch (err) {
      // Distinguish a genuinely missing video from a transient upstream
      // failure in the logs so silent degradation is visible to operators.
      // The page still falls back to the live-site link either way.
      console.error(
        `[demo-search] getDemoPlayableVideo(${slug}/${locale}) failed`,
        err instanceof Error ? err.message : err,
      )
      return null
    }
  },
  ["demo-search-video-v2"],
  { revalidate: 60 },
)

// The outer React `cache()` wrapper was redundant — `unstable_cache` already
// memoizes by key. Keeping just the one layer so the cache story is easy to
// reason about during incident debugging.
export const getDemoPlayableVideo = fetchDemoVideo
