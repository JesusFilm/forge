import "server-only"

import { unstable_cache } from "next/cache"
import {
  adminGraphql,
  type AdminResultOf,
  type AdminVariablesOf,
} from "@forge/admin-graphql"

import client from "@/lib/admin-client"
import { asLocaleSlug, tryAsContentSlug, watchVideoPath } from "@/lib/routes"
import { resolveMuxFrameThumbnailUrl } from "@/lib/url"
import {
  createBoundedRateLimiter,
  trustedClientKey,
} from "@/lib/bounded-rate-limiter"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"
import { isAdmittedWatchInventoryLanguageSlug } from "@/lib/watch-language-inventory"

const WATCH_FILM_FINDER = adminGraphql(`
  query WatchFilmFinder($input: WatchFilmFinderInput!) {
    watchFilmFinder(input: $input) {
      cards {
        laneId
        videoId
        slug
        title
        durationSeconds
        imageUrl
        muxPlaybackId
        videoDubId
      }
      hasNextPage
      endCursor
    }
  }
`)

type AdminInput = AdminVariablesOf<typeof WATCH_FILM_FINDER>["input"]
type AdminCard = AdminResultOf<
  typeof WATCH_FILM_FINDER
>["watchFilmFinder"]["cards"][number]

const LANE_ENUMS = {
  conversation: "CONVERSATION",
  "seven-days": "SEVEN_DAYS",
  kids: "KIDS",
  questions: "QUESTIONS",
  "getting-started": "GETTING_STARTED",
  women: "WOMEN",
  animated: "ANIMATED",
  culture: "CULTURE",
} as const satisfies Record<string, AdminInput["laneIds"][number]>

export type WatchFilmFinderLaneId = keyof typeof LANE_ENUMS
export type WatchFilmFinderDuration = NonNullable<AdminInput["duration"]>
export type WatchFilmFinderInput = {
  laneIds: readonly WatchFilmFinderLaneId[]
  languageSlug: string
  duration: WatchFilmFinderDuration
  first: number
  after?: string
}
export type WatchFilmFinderCard = Pick<
  AdminCard,
  "videoId" | "slug" | "title" | "durationSeconds" | "imageUrl" | "videoDubId"
> & {
  laneId: WatchFilmFinderLaneId
  /** Next Link path; Next adds the configured Watch basePath. */
  href: ReturnType<typeof watchVideoPath>
}
export type WatchFilmFinderPage = {
  cards: WatchFilmFinderCard[]
  hasNextPage: boolean
  endCursor: string | null
}

export class WatchFilmFinderInputError extends Error {
  constructor() {
    super("Invalid film finder filters")
    this.name = "WatchFilmFinderInputError"
  }
}

class WatchFilmFinderUnavailableError extends Error {
  constructor() {
    super("Film finder did not return a page")
    this.name = "WatchFilmFinderUnavailableError"
  }
}

function one(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key)
  if (values.length > 1) throw new WatchFilmFinderInputError()
  return values[0] ?? null
}

function isLane(value: string): value is WatchFilmFinderLaneId {
  return Object.hasOwn(LANE_ENUMS, value)
}

/** Same bounded public vocabulary as Admin; callers cannot select collections. */
export function parseWatchFilmFinderParams(
  params: URLSearchParams,
): WatchFilmFinderInput {
  const allowed = new Set([
    "laneIds",
    "languageSlug",
    "duration",
    "first",
    "after",
  ])
  if (
    params.toString().length > 2048 ||
    [...params.keys()].some((key) => !allowed.has(key))
  )
    throw new WatchFilmFinderInputError()

  const lanes = params.getAll("laneIds")
  if (lanes.length < 1 || lanes.length > 8 || !lanes.every(isLane)) {
    throw new WatchFilmFinderInputError()
  }
  const languageSlug = one(params, "languageSlug")
  if (!languageSlug || !/^[a-z0-9-]{1,80}$/.test(languageSlug)) {
    throw new WatchFilmFinderInputError()
  }
  const duration = one(params, "duration") ?? "ANY"
  if (duration !== "ANY" && duration !== "SHORT" && duration !== "MEDIUM") {
    throw new WatchFilmFinderInputError()
  }
  const rawFirst = one(params, "first") ?? "24"
  const first = Number(rawFirst)
  if (!/^\d{1,2}$/.test(rawFirst) || first < 1 || first > 24) {
    throw new WatchFilmFinderInputError()
  }
  const after = one(params, "after")
  if (
    after !== null &&
    (!/^v1:\d{1,4}$/.test(after) || Number(after.slice(3)) > 512)
  ) {
    throw new WatchFilmFinderInputError()
  }
  return {
    laneIds: [...new Set(lanes)],
    languageSlug,
    duration,
    first,
    ...(after !== null ? { after } : {}),
  }
}

async function fetchWatchFilmFinderPage(
  input: WatchFilmFinderInput,
): Promise<WatchFilmFinderPage> {
  const result = await client.query({
    query: WATCH_FILM_FINDER,
    variables: {
      input: { ...input, laneIds: input.laneIds.map((id) => LANE_ENUMS[id]) },
    },
    fetchPolicy: "no-cache",
    context: {
      // The shared fill is owned by no single visitor: an abort signal here
      // would let one cancelled request fail the fill for every joiner.
      queryDeduplication: false,
      fetchOptions: { cache: "no-store" },
    },
  })
  const page = result.data?.watchFilmFinder
  if (!page) throw new WatchFilmFinderUnavailableError()
  const language = asLocaleSlug(input.languageSlug)
  return {
    cards: page.cards.flatMap((card) => {
      const slug = tryAsContentSlug(card.slug)
      const laneId = input.laneIds.find((id) => LANE_ENUMS[id] === card.laneId)
      if (!slug || !laneId) return []
      // Explicit projection prevents a later Admin selection from accidentally
      // exposing stream/download fields through this public Web response.
      return [
        {
          laneId,
          videoId: card.videoId,
          slug: card.slug,
          title: card.title,
          durationSeconds: card.durationSeconds,
          imageUrl:
            card.imageUrl ?? resolveMuxFrameThumbnailUrl(card.muxPlaybackId),
          videoDubId: card.videoDubId,
          href: watchVideoPath(slug, language),
        },
      ]
    }),
    hasNextPage: page.hasNextPage,
    endCursor: page.endCursor,
  }
}

// The result is public catalog data keyed only by the bounded finder filters
// (no viewer, session, or credential), so one entry serves every visitor. It
// moves only on editorial publish, hence the tags; the short TTL bounds
// staleness if a tag purge is missed. Thrown fills are not retained.
const getCachedWatchFilmFinderPage = unstable_cache(
  fetchWatchFilmFinderPage,
  ["watch-film-finder-v1"],
  {
    revalidate: 300,
    tags: [
      WATCH_CACHE_TAGS.video,
      WATCH_CACHE_TAGS.series,
      WATCH_CACHE_TAGS.settings,
    ],
  },
)

/** Lets one caller walk away from a shared in-flight fill without cancelling it. */
function abandonOnAbort<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) {
    pending.catch(() => undefined)
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    )
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", onAbort, { once: true })
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort)
    })
  })
}

export async function getWatchFilmFinder(
  input: WatchFilmFinderInput,
  signal?: AbortSignal,
): Promise<WatchFilmFinderPage> {
  // The audio language is part of the shared cache key and Admin answers an
  // unknown slug with a cacheable empty success, so admit only the finite
  // public audio-language namespace BEFORE the cached fill: a rejected slug can
  // neither cost an Admin lookup nor retain a Data Cache entry. The corpus
  // answers first; the manifest (one shared, TTL'd, single-flight fetch that
  // degrades to the corpus) is awaited only on a corpus miss.
  if (!(await isAdmittedWatchInventoryLanguageSlug(input.languageSlug))) {
    throw new WatchFilmFinderInputError()
  }
  // Fixed key order and no undefined members: the cache key is the serialized
  // argument, so equal filters must serialize identically.
  const canonical: WatchFilmFinderInput = {
    laneIds: [...input.laneIds],
    languageSlug: input.languageSlug,
    duration: input.duration,
    first: input.first,
    ...(input.after !== undefined ? { after: input.after } : {}),
  }
  return abandonOnAbort(getCachedWatchFilmFinderPage(canonical), signal)
}

/**
 * Per-client admission for the public finder GET. Every valid-looking filter
 * combination is its own shared-cache entry (lane order is rank order, so each
 * permutation, audio language, duration and cursor is distinct), so the cache
 * alone cannot bound Admin load from a caller who varies one parameter per
 * request. 60 per minute per client is far above interactive use (a filter
 * change is one request and the client cancels the superseded one).
 */
export const WATCH_FILM_FINDER_CLIENT_LIMIT = 60
export const WATCH_FILM_FINDER_CLIENT_WINDOW_MS = 60_000
const WATCH_FILM_FINDER_MAX_TRACKED_CLIENTS = 5_000
const WATCH_FILM_FINDER_OVERFLOW_LIMIT = 600

const finderClientLimiter = createBoundedRateLimiter({
  limit: WATCH_FILM_FINDER_CLIENT_LIMIT,
  windowMs: WATCH_FILM_FINDER_CLIENT_WINDOW_MS,
  maxKeys: WATCH_FILM_FINDER_MAX_TRACKED_CLIENTS,
  overflowLimit: WATCH_FILM_FINDER_OVERFLOW_LIMIT,
})

/** Seconds to wait when refused; `null` when the request is admitted. */
export function admitWatchFilmFinderClient(
  headers: Pick<Headers, "get">,
): { retryAfterSeconds: number } | null {
  const result = finderClientLimiter.admit(trustedClientKey(headers))
  return result.allowed ? null : { retryAfterSeconds: result.retryAfterSeconds }
}
