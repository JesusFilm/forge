// Core-semantics test double for the Core GraphQL gateway.
//
// This is deliberately NOT a canned-response stub. It models the subset of
// Core's resolver behaviour that Core Sync depends on, so a test can ask
// "what would Core actually return for this query, sent with these headers?"
// rather than "what did someone hand-write into a fixture?". Canned fixtures
// cannot catch the bug in JesusFilm/forge#2324 at all: the bug is that Core
// hides rows we asked for, and a fixture that hands us the row has already
// assumed the bug away.
//
// It installs at the `fetch` boundary rather than at `coreQuery`, because the
// header Core keys its filter on (`x-graphql-client-name`) is added inside
// `core-client.ts`. Mocking `coreQuery` would make that header — the whole
// mechanism of the bug — invisible to the test.
//
// ---------------------------------------------------------------------------
// Live contract check — 2026-09-16, https://api-gateway.central.jesusfilm.org/
//
// Read-only, unauthenticated probes against the production Core gateway, using
// the known-restricted video from #2324. Every rule below is what those probes
// actually returned; see the pull request for the full transcript.
//
//   1. videos(where: { ids: ["2_ElCamImpulsesVert", "2_ElCamImpulses"] })
//      with `x-graphql-client-name: watch`    -> ["2_ElCamImpulses"]
//      with `x-graphql-client-name: arclight` -> ["2_ElCamImpulses"]
//      with no client-name header             -> both ids
//      => the public root field drops rows whose `restrictViewPlatforms`
//         contains the CALLER'S OWN client name. Rule (2) below.
//
//   2. adminVideos(...) unauthenticated -> GraphQL error
//      "Not authorized to resolve Query.adminVideos"
//      (extensions.code DOWNSTREAM_SERVICE_ERROR, serviceName api-media)
//      => the publisher root field is gated, and rejects loudly rather than
//         returning an empty list. Rule (3) below.
//
//   3. Video.restrictViewPlatforms unauthenticated -> GraphQL error
//      "Not authorized to resolve Video.restrictViewPlatforms"
//      (same code, same service)
//      => the FIELD Core Sync has been selecting since #1829 carries the same
//         publisher gate as the `adminVideos` root field. Core Sync's
//         credential must therefore already satisfy that gate in production,
//         or the videos phase would have been failing on every page since
//         #1829 shipped.
//
//   4. videosCount(where: { published: true })
//      with `x-graphql-client-name: watch` -> 1134
//      with no client-name header          -> 1180
//      => 46 published videos in the live catalogue are restricted from Watch
//         and were therefore invisible to Core Sync. `videosCount(where: {})`
//         returns the same 1134 / 1180, which also confirms the public field
//         filters to published videos implicitly — the reason the images phase
//         has to start sending `published: true` explicitly on the publisher
//         field, which has no such implicit filter.
//
// The `adminVideos` root field could not be exercised with Core Sync's own
// production credential from this environment. `unauthorizedForPublisherField`
// below models what Core does if that inference is wrong, and
// `sync-videos.restrict-view-platforms.test.ts` pins the resulting behaviour:
// the phase fails loudly and soft-deletes nothing.
// ---------------------------------------------------------------------------

export const CORE_SEMANTICS_VERIFIED_AT = "2026-09-16"

/** A video as Core holds it, before any per-caller visibility rule applies. */
export type CoreGatewayVideo = {
  id: string
  /** Core's `Video.restrictViewPlatforms`; `[]` means visible everywhere. */
  restrictViewPlatforms: string[]
  /** Backs Core's `where: { published: true }` filter. */
  published: boolean
  slug?: string
  label?: string | null
  publishedAt?: string | null
  primaryLanguageId?: string | null
  source?: string | null
  updatedAt?: string
  images?: Array<Partial<CoreGatewayImage> & { id: string }>
}

export type CoreGatewayImage = {
  id: string
  updatedAt: string
  aspectRatio: string | null
  url: string | null
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  mobileCinematicVeryLow: string | null
  thumbnail: string | null
  videoStill: string | null
}

type CoreGatewayRequest = {
  /** The root field the query asked for: `videos` or `adminVideos`. */
  rootField: RootField
  /** The value of `x-graphql-client-name`, or undefined if unsent. */
  clientName: string | undefined
  variables: Record<string, unknown>
}

type RootField = "videos" | "adminVideos"

export type CoreGatewayDouble = {
  /** Install as `fetch` via `vi.stubGlobal("fetch", double.fetch)`. */
  fetch: (
    url: string,
    init: { headers?: Record<string, string>; body?: string },
  ) => Promise<{
    ok: boolean
    json: () => Promise<unknown>
  }>
  /** Every request Core received, in order. */
  requests: CoreGatewayRequest[]
  /** Mutate Core's state between sync runs, the way an editor would. */
  videos: CoreGatewayVideo[]
}

function readRootField(query: string): RootField | "bibleBooks" {
  if (/\bbibleBooks\b/.test(query)) return "bibleBooks"
  // `adminVideos` must be tested first: `/\bvideos\b/` does not match inside
  // `adminVideos`, but keeping the order explicit documents the intent.
  if (/(^|[\s{(])adminVideos\s*\(/.test(query)) return "adminVideos"
  if (/(^|[\s{(])videos\s*\(/.test(query)) return "videos"
  throw new Error(
    `core-gateway double: could not find a videos root field in query:\n${query}`,
  )
}

/**
 * Core's visibility rule, as the live probes above measured it.
 *
 * The public `videos` field excludes any video whose `restrictViewPlatforms`
 * contains the caller's OWN client name. That is the self-defeating filter at
 * the heart of #2324: a caller identifying as `watch` can never see the videos
 * restricted from `watch`.
 *
 * `adminVideos` applies no restriction filter at all — it is gated on the
 * caller being a publisher instead.
 */
function isVisible(
  video: CoreGatewayVideo,
  rootField: RootField,
  clientName: string | undefined,
): boolean {
  if (rootField === "adminVideos") return true
  if (clientName == null) return true
  return !video.restrictViewPlatforms.includes(clientName)
}

function toCoreVideoPayload(video: CoreGatewayVideo) {
  return {
    id: video.id,
    slug: video.slug ?? video.id,
    label: video.label ?? "episode",
    publishedAt: video.publishedAt ?? "2026-01-01T00:00:00.000Z",
    primaryLanguageId: video.primaryLanguageId ?? null,
    source: video.source ?? null,
    origin: null,
    title: [],
    description: [],
    snippet: [],
    studyQuestions: [],
    imageAlt: [],
    bibleCitations: [],
    keywords: [],
    children: [],
    locked: false,
    noIndex: false,
    restrictViewPlatforms: video.restrictViewPlatforms,
    updatedAt: video.updatedAt ?? "2026-01-02T00:00:00.000Z",
  }
}

function toCoreImagesPayload(video: CoreGatewayVideo) {
  return {
    id: video.id,
    images: (video.images ?? []).map((image) => ({
      id: image.id,
      updatedAt: image.updatedAt ?? "2026-01-02T00:00:00.000Z",
      aspectRatio: image.aspectRatio ?? "16:9",
      url: image.url ?? `https://example.test/${image.id}.jpg`,
      mobileCinematicHigh: image.mobileCinematicHigh ?? null,
      mobileCinematicLow: image.mobileCinematicLow ?? null,
      mobileCinematicVeryLow: image.mobileCinematicVeryLow ?? null,
      thumbnail: image.thumbnail ?? null,
      videoStill: image.videoStill ?? null,
    })),
  }
}

export function createCoreGatewayDouble({
  videos,
  /**
   * When true, `adminVideos` rejects the way the live gateway rejects an
   * unauthorized caller — a GraphQL error, not an empty list. Models the one
   * belief the 2026-09-16 probes could not confirm with Core Sync's own
   * credential.
   */
  unauthorizedForPublisherField = false,
}: {
  videos: CoreGatewayVideo[]
  unauthorizedForPublisherField?: boolean
}): CoreGatewayDouble {
  const requests: CoreGatewayRequest[] = []
  const state = { videos }

  const double: CoreGatewayDouble = {
    requests,
    get videos() {
      return state.videos
    },
    set videos(next: CoreGatewayVideo[]) {
      state.videos = next
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body ?? "{}") as {
        query: string
        variables?: Record<string, unknown>
      }
      const query = body.query
      const variables = body.variables ?? {}
      // Header lookup is case-insensitive because that is how HTTP behaves;
      // `core-client.ts` happens to send lower-case today.
      const headerEntry = Object.entries(init.headers ?? {}).find(
        ([key]) => key.toLowerCase() === "x-graphql-client-name",
      )
      const clientName = headerEntry?.[1]

      const rootField = readRootField(query)
      if (rootField === "bibleBooks") {
        return { ok: true, json: async () => ({ data: { bibleBooks: [] } }) }
      }

      requests.push({ rootField, clientName, variables })

      if (rootField === "adminVideos" && unauthorizedForPublisherField) {
        return {
          ok: true,
          json: async () => ({
            data: null,
            errors: [
              {
                message: "Not authorized to resolve Query.adminVideos",
                path: ["adminVideos"],
                extensions: {
                  code: "DOWNSTREAM_SERVICE_ERROR",
                  serviceName: "api-media",
                },
              },
            ],
          }),
        }
      }

      const where = (variables.where ?? {}) as { published?: boolean }
      const offset = typeof variables.offset === "number" ? variables.offset : 0
      const limit = typeof variables.limit === "number" ? variables.limit : 25

      const matching = state.videos
        .filter((video) => isVisible(video, rootField, clientName))
        .filter((video) => where.published !== true || video.published)
      const page = matching.slice(offset, offset + limit)

      const wantsImages = /\bimages\s*{/.test(query)
      return {
        ok: true,
        json: async () => ({
          data: {
            [rootField]: page.map((video) =>
              wantsImages
                ? toCoreImagesPayload(video)
                : toCoreVideoPayload(video),
            ),
          },
        }),
      }
    },
  }

  return double
}
