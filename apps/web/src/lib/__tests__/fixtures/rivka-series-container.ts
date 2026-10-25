/**
 * Fixtures for a series CONTAINER that owns no playable dubs of its own —
 * the Rivka shape. Admin's `preferredPlayableDub` resolves against the
 * container's OWN dub rows and a container has none, so the container's
 * playability can only come from a descendant episode.
 *
 * Shared by the resolver suite (series-descendant-variant.test.ts) and the
 * page suite (series-container-hero.test.tsx) so the two cannot drift.
 *
 * NOTE: the admin behaviour these fixtures encode is asserted nowhere in this
 * repo — `episodeSnapshot` hardcodes the primary-dub fallback because that is
 * what apps/admin's `preferredPlayableDub` does. Verified by reading
 * apps/admin/src/services/video.service.ts on 2026-09-16. If that resolver
 * changes, these fixtures lie and both suites keep passing.
 */

export const LANGUAGES = {
  english: { coreId: "529", bcp47: "en", slug: "english", name: "English" },
  mandarin: {
    coreId: "21754",
    bcp47: "zh",
    slug: "mandarin-china",
    name: "Chinese, Mandarin",
  },
} as const

export type LanguageKey = keyof typeof LANGUAGES

/** Per-episode dub coverage, in child order. `null` = admin resolves nothing. */
export type EpisodePlan = Record<string, readonly LanguageKey[] | null>

export const TWO_EPISODES: EpisodePlan = {
  "rivka-1": ["english", "mandarin"],
  "rivka-2": ["english", "mandarin"],
}

function dub(languageKey: keyof typeof LANGUAGES, videoSlug: string) {
  const language = LANGUAGES[languageKey]
  return {
    documentId: `dub-${videoSlug}-${language.slug}`,
    slug: `${videoSlug}-${language.slug}`,
    published: true,
    hls: `https://stream.example/${videoSlug}/${language.slug}.m3u8`,
    duration: 300,
    muxHeroPosterBlurDataUrl: null,
    language,
  }
}

function locale(documentId: string, languageSlug: string, title: string) {
  return {
    documentId,
    languageSlug,
    publishedAt: "2026-01-01T00:00:00.000Z",
    title,
    description: `${title} description`,
    snippet: `${title} snippet`,
    imageAlt: null,
  }
}

function baseSnapshot(slug: string) {
  return {
    documentId: `doc-${slug}`,
    slug,
    publishedAt: "2026-01-01T00:00:00.000Z",
    noIndex: false,
    images: [],
    primaryLanguage: { coreId: LANGUAGES.english.coreId, bcp47: "en" },
    parents: [],
    children: [],
    bibleCitations: [],
    exactLocales: [],
    broadLocales: [],
    englishLocales: [locale(`loc-${slug}-en`, "english", `${slug} EN`)],
    exactStudyQuestions: [],
    broadStudyQuestions: [],
    englishStudyQuestions: [],
    playableDubLanguageCount: 0,
    preferredVariant: null,
  }
}

/** The container: zero playable dubs of its own, episode children in order. */
function containerSnapshot(
  childSlugs: readonly string[],
  childLabel = "episode",
) {
  return {
    ...baseSnapshot("rivka"),
    label: "series",
    exactLocales: [locale("loc-rivka-zh", "mandarin-china", "Rivka ZH")],
    children: childSlugs.map((slug) => ({
      child: {
        documentId: `doc-${slug}`,
        slug,
        label: slug.startsWith("nested-") ? "series" : childLabel,
        muxPlaybackId: `pb-${slug}`,
        muxThumbnailBlurDataUrl: null,
        muxHeroPosterBlurDataUrl: null,
        durationSeconds: 300,
        images: [],
        exactLocales: [
          {
            documentId: `loc-${slug}-zh`,
            languageSlug: "mandarin-china",
            title: `${slug} ZH`,
          },
        ],
        broadLocales: [],
        englishLocales: [
          {
            documentId: `loc-${slug}-en`,
            languageSlug: "english",
            title: `${slug} EN`,
          },
        ],
      },
    })),
  }
}

/**
 * An episode. `dubbedLanguages` mirrors admin's `preferredPlayableDub`
 * fallback: when the requested language has no dub the episode still answers
 * with its primary (English) one.
 */
function episodeSnapshot(
  slug: string,
  requestedLanguageSlug: string | null,
  dubbedLanguages: readonly LanguageKey[],
) {
  const requested = dubbedLanguages.find(
    (key) => LANGUAGES[key].slug === requestedLanguageSlug,
  )
  return {
    ...baseSnapshot(slug),
    label: "episode",
    exactLocales: [locale(`loc-${slug}-zh`, "mandarin-china", `${slug} ZH`)],
    parents: [
      {
        parent: {
          documentId: "doc-rivka",
          slug: "rivka",
          noIndex: false,
          label: "series",
          images: [],
          exactLocales: [],
          broadLocales: [],
          englishLocales: [
            { documentId: "p-en", languageSlug: "english", title: "Rivka" },
          ],
        },
      },
    ],
    playableDubLanguageCount: dubbedLanguages.length,
    preferredVariant: dub(requested ?? dubbedLanguages[0], slug),
  }
}

export function operationName(doc: unknown): string {
  const definitions = (doc as { definitions?: { name?: { value?: string } }[] })
    .definitions
  return definitions?.[0]?.name?.value ?? "unknown"
}

/**
 * The admin query implementation for a Rivka-shaped series: one container
 * that owns no dubs, plus episode children whose per-language coverage the
 * caller dictates. Wire it into a test file's own hoisted query mock.
 */
export function buildAdminQueryImplementation(plan: EpisodePlan) {
  const childSlugs = Object.keys(plan)
  return async ({
    query,
    variables,
  }: {
    query: unknown
    variables: Record<string, unknown>
  }) => {
    const name = operationName(query)
    if (name === "GetWatchVideoRouteSnapshotBySlug") {
      const videoSlug = String(variables.videoSlug)
      if (videoSlug === "rivka") {
        return {
          data: {
            watchVideoRouteSnapshotBySlug: containerSnapshot(childSlugs),
          },
        }
      }
      const dubs = plan[videoSlug]
      if (dubs === undefined || dubs === null) {
        // `null` is a child admin cannot resolve (unpublished, pruned).
        return { data: { watchVideoRouteSnapshotBySlug: null } }
      }
      if (videoSlug.startsWith("nested-")) {
        // A container child: like the parent, it owns no dubs of its own.
        return {
          data: {
            watchVideoRouteSnapshotBySlug: containerSnapshot([], "episode"),
          },
        }
      }
      return {
        data: {
          watchVideoRouteSnapshotBySlug: episodeSnapshot(
            videoSlug,
            (variables.languageSlug as string | null) ?? null,
            dubs,
          ),
        },
      }
    }
    if (name === "GetVideoChildDubLanguages") {
      const covered = new Set<LanguageKey>()
      for (const dubs of Object.values(plan)) {
        for (const key of dubs ?? []) covered.add(key)
      }
      return {
        data: {
          videoBySlug: {
            documentId: "doc-rivka",
            childDubLanguages: [...covered].map((key) => LANGUAGES[key]),
          },
        },
      }
    }
    if (name === "GetWatchVideoDubDetail") {
      return { data: { videoDub: null } }
    }
    return { data: {} }
  }
}
