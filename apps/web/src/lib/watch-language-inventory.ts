import type { Route } from "next"
import { unstable_cache } from "next/cache"
import { adminGraphql, type AdminResultOf } from "@forge/admin-graphql"

import adminClient from "@/lib/admin-client"
import {
  isPublicWatchHomeLanguageSlug,
  publicWatchHomeLanguageSlugForLocale,
} from "@/lib/locale"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
  watchVideoPath,
} from "@/lib/routes"
import { WATCH_CACHE_TAGS } from "@/lib/watch-cache-tags"
import { getWatchRouteManifest } from "@/lib/watch-route-manifest"

const WATCH_LANGUAGE_INVENTORY_LIMIT = 1_000
const WATCH_LANGUAGE_SWITCHER_LIMIT = 5_000
const WATCH_LANGUAGE_SWITCHER_PAGE_SIZE = 500

const watchLanguageInventoryItemFragment = adminGraphql(`
  fragment WatchLanguageInventoryItemFields on WatchLanguageInventoryItem @_unmask {
    id
    coreId
    slug
    title
    description
    imageUrl
    imageAlt
    muxPlaybackId
    label
    availability
    watchLanguageSlug
    parentSlug
    parentTitle
    parentOrder
    durationSeconds
    childCount
    publishedAt
    createdAt
    updatedAt
  }
`)

const getWatchCollectionLanguageCountsOperation = adminGraphql(`
  query GetWatchCollectionLanguageCounts($slugs: [String!]!) {
    watchCollectionLanguageCounts(slugs: $slugs) {
      slug
      audioLanguageCount
      subtitleLanguageCount
    }
  }
`)

const getWatchLanguageInventoryOperation = adminGraphql(
  `
    query GetWatchLanguageInventory($languageSlug: String!, $limit: Int) {
      watchLanguageInventory(languageSlug: $languageSlug, limit: $limit) {
        language {
          slug
          bcp47
          name
        }
        counts {
          audioCollections
          audioVideos
          subtitleOnlyVideos
          total
        }
        promoted {
          ...WatchLanguageInventoryItemFields
        }
        audioCollections {
          ...WatchLanguageInventoryItemFields
        }
        audioVideos {
          ...WatchLanguageInventoryItemFields
        }
        subtitleOnlyVideos {
          ...WatchLanguageInventoryItemFields
        }
      }
    }
  `,
  [watchLanguageInventoryItemFragment],
)

const getWatchLanguageInventoryLanguagesOperation = adminGraphql(`
  query GetWatchLanguageInventoryLanguages($limit: Int, $offset: Int) {
    languages(limit: $limit, offset: $offset) {
      slug
      bcp47
      name
    }
  }
`)

type WatchLanguageInventoryRaw = NonNullable<
  AdminResultOf<
    typeof getWatchLanguageInventoryOperation
  >["watchLanguageInventory"]
>

type WatchLanguageInventoryItemRaw =
  WatchLanguageInventoryRaw["audioVideos"][number]

type WatchLanguageInventoryLanguageRaw = NonNullable<
  AdminResultOf<typeof getWatchLanguageInventoryLanguagesOperation>["languages"]
>[number]

export type WatchLanguageInventoryAvailability =
  WatchLanguageInventoryItemRaw["availability"]

export type WatchLanguageInventoryCard = {
  id: string
  coreId: string
  slug: string
  title: string
  description: string | null
  imageUrl: string | null
  imageAlt: string
  /**
   * Frame source for videos with no authored artwork. Kept separate from
   * `imageUrl` so surfaces that need a specific resolution (or that pick a
   * hero by "first item with real artwork") can decide for themselves.
   */
  muxPlaybackId: string | null
  label: string | null
  availability: WatchLanguageInventoryAvailability
  href: Route | null
  watchLanguageSlug: string
  parentSlug: string | null
  parentTitle: string | null
  parentOrder?: number | null
  durationSeconds: number | null
  childCount: number
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type WatchLanguageInventorySwitcherLanguage = {
  slug: string
  languageName: string
  nativeName: string | null
  bcp47: string | null
}

export type WatchLanguageInventoryModel = {
  languageSlug: string
  languageName: string
  languageNativeName: string | null
  switcherLanguages: WatchLanguageInventorySwitcherLanguage[]
  counts: WatchLanguageInventoryRaw["counts"]
  promoted: WatchLanguageInventoryCard[]
  audioCollections: WatchLanguageInventoryCard[]
  audioVideos: WatchLanguageInventoryCard[]
  subtitleOnlyVideos: WatchLanguageInventoryCard[]
  /// Per-collection language availability, keyed by collection slug. Absent
  /// entries mean "not known" (the counts query failed or the collection has
  /// no children) — NOT "zero languages", which is why the sidebar renders
  /// nothing rather than a 0 for a missing entry.
  collectionLanguageCounts: Record<string, WatchCollectionLanguageCounts>
}

export type WatchCollectionLanguageCounts = {
  audioLanguageCount: number
  subtitleLanguageCount: number
}

type ErrorLike = { message?: string }

function graphqlError(result: {
  error?: ErrorLike
  errors?: readonly unknown[]
}): Error | null {
  if (result.error) return new Error(result.error.message ?? "GraphQL error")
  if (result.errors?.length) return new Error("GraphQL errors")
  return null
}

async function queryWatchLanguageInventory(
  languageSlug: string,
): Promise<WatchLanguageInventoryRaw> {
  const result = await adminClient.query({
    query: getWatchLanguageInventoryOperation,
    variables: {
      languageSlug,
      limit: WATCH_LANGUAGE_INVENTORY_LIMIT,
    },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error
  if (!result.data?.watchLanguageInventory) {
    throw new Error("Watch language inventory response was empty")
  }
  return result.data.watchLanguageInventory
}

async function queryWatchLanguageInventoryLanguages(): Promise<
  WatchLanguageInventoryLanguageRaw[]
> {
  const languages: WatchLanguageInventoryLanguageRaw[] = []

  for (
    let offset = 0;
    offset < WATCH_LANGUAGE_SWITCHER_LIMIT;
    offset += WATCH_LANGUAGE_SWITCHER_PAGE_SIZE
  ) {
    const result = await adminClient.query({
      query: getWatchLanguageInventoryLanguagesOperation,
      variables: {
        limit: WATCH_LANGUAGE_SWITCHER_PAGE_SIZE,
        offset,
      },
      fetchPolicy: "no-cache",
    })

    const error = graphqlError(
      result as { error?: ErrorLike; errors?: unknown[] },
    )
    if (error) throw error

    const page = result.data?.languages ?? []
    languages.push(...page)

    if (page.length < WATCH_LANGUAGE_SWITCHER_PAGE_SIZE) break
  }

  return languages
}

// Admin omits unknown slugs and does NOT preserve request order, so the result
// must be joined back by slug — never zipped by index.
async function queryWatchCollectionLanguageCounts(
  slugs: readonly string[],
): Promise<Record<string, WatchCollectionLanguageCounts>> {
  if (slugs.length === 0) return {}

  const result = await adminClient.query({
    query: getWatchCollectionLanguageCountsOperation,
    variables: { slugs: [...slugs] },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  const counts: Record<string, WatchCollectionLanguageCounts> = {}
  for (const row of result.data?.watchCollectionLanguageCounts ?? []) {
    counts[row.slug] = {
      audioLanguageCount: row.audioLanguageCount,
      subtitleLanguageCount: row.subtitleLanguageCount,
    }
  }
  return counts
}

const fetchWatchCollectionLanguageCounts = unstable_cache(
  queryWatchCollectionLanguageCounts,
  ["watch-collection-language-counts"],
  {
    // Cached far harder than the inventory itself (60s): a collection's
    // language roster changes when a new dub is published, i.e. rarely, and
    // this is decoration rather than routing or playability. The route is
    // `force-static` with `revalidate = 3600`, so this never runs on a
    // visitor's request path at all — it runs during ISR regeneration.
    revalidate: 86_400,
    tags: [WATCH_CACHE_TAGS.video, WATCH_CACHE_TAGS.series],
  },
)

// The indicator is decoration. A failure here must cost the page nothing, so
// the whole call is swallowed into "no counts known" rather than propagated.
async function resolveCollectionLanguageCounts(
  slugs: readonly string[],
): Promise<Record<string, WatchCollectionLanguageCounts>> {
  try {
    return await fetchWatchCollectionLanguageCounts(slugs)
  } catch (error) {
    console.error(
      `[watch] event=watch_collection_language_counts.failed collections=${slugs.length} detail=${
        error instanceof Error
          ? error.message.replaceAll(/\s+/g, "_")
          : "unknown"
      }`,
    )
    return {}
  }
}

const fetchWatchLanguageInventory = unstable_cache(
  queryWatchLanguageInventory,
  ["watch-language-inventory"],
  {
    revalidate: 60,
    tags: [WATCH_CACHE_TAGS.video, WATCH_CACHE_TAGS.series],
  },
)

const fetchWatchLanguageInventoryLanguages = unstable_cache(
  queryWatchLanguageInventoryLanguages,
  ["watch-language-inventory-languages", "paginated"],
  {
    revalidate: 3600,
    tags: [WATCH_CACHE_TAGS.video, WATCH_CACHE_TAGS.routeManifest],
  },
)

function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function firstLocalizedName(name: unknown): string | null {
  if (name && typeof name === "object" && !Array.isArray(name)) {
    const record = name as Record<string, unknown>
    for (const key of ["en", "name", "native", "nativeName", "value"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
    for (const value of Object.values(record)) {
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  if (typeof name === "string" && name.trim()) return name.trim()
  return null
}

function languageNameFromJson(name: unknown, slug: string): string {
  return firstLocalizedName(name) ?? labelFromSlug(slug)
}

function nativeLanguageNameFromJson(
  name: unknown,
  bcp47: string | null | undefined,
  englishName: string,
): string | null {
  if (!name || typeof name !== "object" || Array.isArray(name)) return null
  const record = name as Record<string, unknown>
  const candidates = [
    bcp47,
    bcp47?.split("-")[0],
    "native",
    "nativeName",
    "local",
  ].filter((candidate): candidate is string => candidate != null)

  for (const candidate of candidates) {
    const value = record[candidate]
    if (
      typeof value === "string" &&
      value.trim() &&
      value.trim().toLowerCase() !== englishName.toLowerCase()
    ) {
      return value.trim()
    }
  }

  return null
}

function switcherLanguageFromRaw(
  language: WatchLanguageInventoryLanguageRaw,
): WatchLanguageInventorySwitcherLanguage | null {
  const slug = language.slug
  if (!slug || !isPublicWatchHomeLanguageSlug(slug)) return null
  const languageName = languageNameFromJson(language.name, slug)
  return {
    slug,
    languageName,
    nativeName: nativeLanguageNameFromJson(
      language.name,
      language.bcp47,
      languageName,
    ),
    bcp47: language.bcp47 ?? null,
  }
}

function uniqueSwitcherLanguages(
  languages: WatchLanguageInventorySwitcherLanguage[],
): WatchLanguageInventorySwitcherLanguage[] {
  const bySlug = new Map<string, WatchLanguageInventorySwitcherLanguage>()
  for (const language of languages) {
    if (!bySlug.has(language.slug)) bySlug.set(language.slug, language)
  }
  return [...bySlug.values()]
}

async function resolveSwitcherLanguages(
  current: WatchLanguageInventorySwitcherLanguage,
): Promise<WatchLanguageInventorySwitcherLanguage[]> {
  const [languages, manifest] = await Promise.all([
    fetchWatchLanguageInventoryLanguages(),
    getWatchRouteManifest(),
  ])
  const manifestLanguageSlugs = new Set(manifest?.audioLanguageSlugs ?? [])
  const options = languages
    .flatMap((language) => {
      const option = switcherLanguageFromRaw(language)
      return option ? [option] : []
    })
    .filter(
      (option) =>
        manifestLanguageSlugs.size === 0 ||
        manifestLanguageSlugs.has(option.slug) ||
        option.slug === current.slug,
    )

  return uniqueSwitcherLanguages([current, ...options]).sort((a, b) => {
    if (a.slug === current.slug) return -1
    if (b.slug === current.slug) return 1
    return a.languageName.localeCompare(b.languageName)
  })
}

/**
 * Switcher options WITHOUT the language's inventory payload.
 *
 * `resolveWatchLanguageInventory` also fetches every promoted card,
 * collection, dubbed video, and subtitle-only video for the language; a
 * surface that only needs the language LIST (the /whats-new switcher)
 * must not pay for that. Degrades to the current language alone when
 * Admin is unreachable, so an otherwise data-free static page never fails
 * to render because of this control.
 */
export async function resolveWatchLanguageSwitcherOptions(
  currentSlug: string,
): Promise<WatchLanguageInventorySwitcherLanguage[]> {
  const fallback = {
    slug: currentSlug,
    languageName: labelFromSlug(currentSlug),
    nativeName: null,
    bcp47: null,
  } satisfies WatchLanguageInventorySwitcherLanguage

  try {
    const languages = await fetchWatchLanguageInventoryLanguages()
    const current =
      languages
        .flatMap((language) => {
          const option = switcherLanguageFromRaw(language)
          return option && option.slug === currentSlug ? [option] : []
        })
        .at(0) ?? fallback
    return await resolveSwitcherLanguages(current)
  } catch {
    return [fallback]
  }
}

export function primaryLanguageNameForSeo(languageName: string): string {
  const trimmed = languageName.trim()
  const [primary] = trimmed.split(",")
  return primary?.trim() || trimmed || "Global"
}

export function watchLanguageSpeakingAudience(languageName: string): string {
  return `${primaryLanguageNameForSeo(languageName)}-speaking audiences`
}

export function watchLanguageInventorySeoTitle(languageName: string): string {
  return `Free Christian Video Library for ${primaryLanguageNameForSeo(languageName)}-Speaking Audiences | Jesus Film Project`
}

export function watchLanguageInventorySeoDescription(
  languageName: string,
): string {
  return `Watch free Christian videos, Jesus films, Bible stories, and discipleship series for ${watchLanguageSpeakingAudience(languageName)}, with fully dubbed videos and subtitles in ${languageName}.`
}

function buildInventoryHref(
  item: WatchLanguageInventoryItemRaw,
  inventoryLanguageSlug: string,
): Route | null {
  const slug = tryAsContentSlug(item.slug)
  const lang = tryAsLocaleSlug(item.watchLanguageSlug)
  if (!slug || !lang) return null

  const subtitleLanguage =
    item.availability === "SUBTITLE_ONLY"
      ? tryAsLocaleSlug(inventoryLanguageSlug)
      : null
  if (item.availability === "SUBTITLE_ONLY" && !subtitleLanguage) return null
  const options = subtitleLanguage ? { subtitleLanguage } : undefined

  if (item.parentSlug) {
    const parent = tryAsContentSlug(item.parentSlug)
    if (parent) return watchEpisodePath(parent, slug, lang, options)
  }

  return watchVideoPath(slug, lang, options)
}

function normalizeCard(
  item: WatchLanguageInventoryItemRaw,
  inventoryLanguageSlug: string,
) {
  return {
    id: item.id,
    coreId: item.coreId,
    slug: item.slug,
    title: item.title,
    description: item.description ?? null,
    imageUrl: item.imageUrl ?? null,
    imageAlt: item.imageAlt ?? item.title,
    muxPlaybackId: item.muxPlaybackId ?? null,
    label: item.label ?? null,
    availability: item.availability,
    href: buildInventoryHref(item, inventoryLanguageSlug),
    watchLanguageSlug: item.watchLanguageSlug,
    parentSlug: item.parentSlug ?? null,
    parentTitle: item.parentTitle ?? null,
    parentOrder: item.parentOrder ?? null,
    durationSeconds: item.durationSeconds ?? null,
    childCount: item.childCount,
    publishedAt: item.publishedAt ?? null,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
  } satisfies WatchLanguageInventoryCard
}

export async function resolveWatchLanguageInventory(
  locale: string,
  routeLanguageSegment?: string | null,
): Promise<WatchLanguageInventoryModel> {
  const languageSlug =
    routeLanguageSegment && isPublicWatchHomeLanguageSlug(routeLanguageSegment)
      ? routeLanguageSegment
      : (publicWatchHomeLanguageSlugForLocale(locale) ?? "english")
  const raw = await fetchWatchLanguageInventory(languageSlug)
  const resolvedLanguageSlug = raw.language?.slug ?? languageSlug
  const languageName = languageNameFromJson(
    raw.language?.name,
    resolvedLanguageSlug,
  )
  const languageNativeName = nativeLanguageNameFromJson(
    raw.language?.name,
    raw.language?.bcp47,
    languageName,
  )
  const currentSwitcherLanguage = {
    slug: resolvedLanguageSlug,
    languageName,
    nativeName: languageNativeName,
    bcp47: raw.language?.bcp47 ?? null,
  } satisfies WatchLanguageInventorySwitcherLanguage
  // Independent of each other, so they must not form a serial waterfall on the
  // ISR regeneration path.
  const [switcherLanguages, collectionLanguageCounts] = await Promise.all([
    resolveSwitcherLanguages(currentSwitcherLanguage),
    resolveCollectionLanguageCounts(
      raw.audioCollections
        .map((collection) => collection.slug)
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ])
  const normalizeInventoryCard = (item: WatchLanguageInventoryItemRaw) =>
    normalizeCard(item, resolvedLanguageSlug)

  return {
    languageSlug: resolvedLanguageSlug,
    languageName,
    languageNativeName,
    switcherLanguages,
    counts: raw.counts,
    promoted: raw.promoted.map(normalizeInventoryCard),
    audioCollections: raw.audioCollections.map(normalizeInventoryCard),
    audioVideos: raw.audioVideos.map(normalizeInventoryCard),
    subtitleOnlyVideos: raw.subtitleOnlyVideos.map(normalizeInventoryCard),
    collectionLanguageCounts,
  }
}

// A series wears the new-release badge for 60 days after the COLLECTION's own
// publish date (decided 2026-08-27; the alternative — newest episode date —
// would keep long-running series permanently fresh, which is not what "new
// release" means here).
export const NEW_RELEASE_WINDOW_DAYS = 60

const NEW_RELEASE_WINDOW_MS = NEW_RELEASE_WINDOW_DAYS * 24 * 60 * 60 * 1000

// Future dates are legitimate but only just: admin stores date-only midnights,
// so a renderer behind that boundary sees "tomorrow". Anything further ahead is
// a data error, and left unbounded it would pin that collection to the top of
// the page, take the hero, and wear a NEW badge forever.
const PUBLISHED_AT_FUTURE_TOLERANCE_DAYS = 2
const PUBLISHED_AT_FUTURE_TOLERANCE_MS =
  PUBLISHED_AT_FUTURE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000

// Admin serves Postgres timestamps as `2026-07-31 00:00:00+00` — a space
// separator and a bare two-digit UTC offset. Neither is valid ISO-8601, so
// `Date.parse` accepts that form only through V8's implementation-defined
// fallback path, which is not something to build a feature on.
//
// Normalize to real ISO instead. Two traps, both measured by hand on node
// 24.19.0 (2026-08-27), both silent — they yield "no badge, ever", never an
// error:
//   1. Replacing ONLY the space is worse than doing nothing: once a `T` is
//      present the strict ISO parser runs and rejects the bare offset, so
//      `2026-07-31T00:00:00+00` is NaN while the original string parses.
//   2. Expanding the offset with a loose `/([+-]\d{2})$/` corrupts a bare
//      date — `2026-07-31` ends in `-31`, so it becomes `2026-07-31:00`.
//      Hence the offset expansion is gated on a preceding time component.
/// Parsed publish time, or NaN when unusable OR implausibly far in the future.
/// Shared by the badge, the sort, and the age windows so one bad row cannot be
/// treated differently by each.
export function publishedAtSortTime(value: string, now: Date): number {
  const parsed = parsePublishedAt(value)
  if (Number.isNaN(parsed)) return Number.NaN
  return parsed > now.getTime() + PUBLISHED_AT_FUTURE_TOLERANCE_MS
    ? Number.NaN
    : parsed
}

export function parsePublishedAt(value: string): number {
  const withTimeSeparator = value.replace(" ", "T")
  const normalized = /T[\d:.]+[+-]\d{2}$/.test(withTimeSeparator)
    ? `${withTimeSeparator}:00`
    : withTimeSeparator
  return Date.parse(normalized)
}

// Future `publishedAt` values DO badge: admin stores date-only publish dates at
// midnight UTC, so a series dated "tomorrow" is legitimately the newest thing
// in the catalog for any render running behind that boundary. Unparseable and
// absent dates fail closed.
export function isNewRelease(
  publishedAt: string | null | undefined,
  now: Date,
): boolean {
  if (!publishedAt) return false
  const parsed = parsePublishedAt(publishedAt)
  if (Number.isNaN(parsed)) return false
  if (parsed > now.getTime() + PUBLISHED_AT_FUTURE_TOLERANCE_MS) return false
  return parsed >= now.getTime() - NEW_RELEASE_WINDOW_MS
}

// ---------------------------------------------------------------------------
// Inventory filter facets
//
// Every dimension here is derived from fields the inventory payload ALREADY
// carries (`durationSeconds`, `label`, `availability`, `publishedAt`), so
// filtering costs no extra query and no admin change.
//
// Two axes the product asked for are deliberately absent because the data does
// not support them (surveyed against a restored production snapshot,
// 2026-08-27, 1,107 videos):
//   - Release year: `video.published_at` is the platform-publish/sync stamp,
//     not a production year — every row is 2025 (1,024) or 2026 (83). The
//     honest version of that axis is `recent` below.
//   - Animated / explainer format: `animated` tags 9 videos, `animation` 3,
//     `explainer` 0. Needs new admin tagging before it can be a filter.
// ---------------------------------------------------------------------------

export type InventoryLengthBucket = "under5" | "5to10" | "10to30" | "over30"
export type InventoryTypeGroup =
  | "featureFilm"
  | "shortFilm"
  | "episode"
  | "collection"

/// Bucket boundaries follow the real distribution rather than round numbers:
/// 30-60min holds exactly ONE English video, so a separate bucket for it would
/// render a permanently near-empty option. 30+ is one bucket.
export function inventoryLengthBucket(
  durationSeconds: number | null,
): InventoryLengthBucket | null {
  if (durationSeconds == null || durationSeconds <= 0) return null
  if (durationSeconds < 300) return "under5"
  if (durationSeconds < 600) return "5to10"
  if (durationSeconds < 1800) return "10to30"
  return "over30"
}

/// Feature and short films stay SEPARATE (product decision 2026-08-27) even
/// though `featureFilm` is only 12 English items against `shortFilm`'s 171 —
/// the distinction is the point of the filter. `episode`/`segment` and
/// `series`/`collection` still pair up, because those splits are internal
/// bookkeeping rather than something a viewer chooses between.
export function inventoryTypeGroup(
  label: string | null,
): InventoryTypeGroup | null {
  switch (label) {
    case "featureFilm":
      return "featureFilm"
    case "shortFilm":
      return "shortFilm"
    case "episode":
    case "segment":
      return "episode"
    case "series":
    case "collection":
      return "collection"
    default:
      return null
  }
}

/// Whole days between `publishedAt` and `now`, for the date-window filter.
///
/// NOTE the axis this measures: `publishedAt` is when the video was published
/// on the PLATFORM, not when the film was released. Surveyed 2026-08-27 against
/// a production snapshot, 89% of the English library (887 of 1,001 items)
/// carries a single month — 2025-06, the bulk import — which is why the offered
/// windows stop at 12 months. A "last 2 years" option would match 1,001 of
/// 1,001 and filter nothing.
export function inventoryAgeDays(
  publishedAt: string | null,
  now: Date,
): number | null {
  if (!publishedAt) return null
  const parsed = publishedAtSortTime(publishedAt, now)
  if (Number.isNaN(parsed)) return null
  // A just-future publish (date-only midnight) counts as 0 days old rather than
  // negative, so it lands in the newest window.
  return Math.max(0, Math.floor((now.getTime() - parsed) / 86_400_000))
}

/// Cumulative windows: choosing 6 months includes everything inside 60 days.
/// Counts on the English page at the time of writing: 3 / 72 / 85 of 1,001.
export const INVENTORY_ADDED_WINDOW_DAYS = {
  "60d": 60,
  "6m": 183,
  "12m": 365,
} as const

export type InventoryAddedWindow = keyof typeof INVENTORY_ADDED_WINDOW_DAYS

export type InventoryFilterFacets = {
  id: string
  length: InventoryLengthBucket | null
  type: InventoryTypeGroup | null
  ageDays: number | null
}

export function inventoryFilterFacets(
  card: WatchLanguageInventoryCard,
  now: Date,
): InventoryFilterFacets {
  return {
    id: card.id,
    length: inventoryLengthBucket(card.durationSeconds),
    type: inventoryTypeGroup(card.label),
    ageDays: inventoryAgeDays(card.publishedAt, now),
  }
}
