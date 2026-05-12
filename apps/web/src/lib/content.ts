import type { ErrorLike } from "@apollo/client"
import { cache } from "react"
import { unstable_cache } from "next/cache"
import { graphql, type ResultOf } from "@forge/graphql"
import client from "@/lib/client"
import adminClient from "@/lib/admin-client"
import { getContentApiMode } from "@/lib/content-api-mode"
import {
  runDualReadComparison,
  type DualReadOutcome,
} from "@/lib/parity-bridge"
import type { EnrichedMediaItem } from "@/lib/enrichment"
import { enrichRouteRelatedVideo } from "@/lib/enrichment"
import {
  adminExperienceBySlugOperation,
  getWatchVideoBySlugOperation,
  getWatchVideoOperation,
  watchExperienceFragment,
  watchVideoFragment,
} from "@/lib/fragments"

// U2: import the new watch-page fragment so its presence keeps the gql.tada
// introspection types live.
void watchVideoFragment

const GET_EXPERIENCE = graphql(`
  query GetExperience($slug: String!, $locale: I18NLocaleCode!) {
    experiences(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
    }
  }
`)

const GET_WATCH_EXPERIENCE = graphql(
  `
    query GetWatchExperience(
      $locale: I18NLocaleCode!
      $filters: ExperienceFiltersInput!
    ) {
      experiences(filters: $filters, locale: $locale) {
        ...WatchExperience
      }
    }
  `,
  [watchExperienceFragment],
)

const GET_WATCH_SETTINGS = graphql(
  `
    query GetWatchSettings($locale: I18NLocaleCode!) {
      watchSetting(locale: $locale) {
        documentId
        homepageExperience {
          ...WatchExperience
        }
        defaultTemplateExperience {
          ...WatchExperience
        }
      }
    }
  `,
  [watchExperienceFragment],
)

const GET_ROUTE_VIDEO = graphql(`
  query GetRouteVideo($slug: String!, $locale: I18NLocaleCode!) {
    videos(filters: { slug: { eq: $slug } }, locale: $locale) {
      documentId
      slug
      title
      snippet
      description
      imageAlt
      noIndex
      images {
        url
      }
      primaryLanguage {
        coreId
      }
      variants(pagination: { limit: -1 }) {
        documentId
        hls
        published
        language {
          coreId
        }
      }
      children(pagination: { limit: 24 }) {
        documentId
        slug
        title
        label
        images {
          url
        }
      }
    }
  }
`)

type WatchData = ResultOf<typeof GET_WATCH_EXPERIENCE>
type WatchSettingsData = ResultOf<typeof GET_WATCH_SETTINGS>
type RouteVideoData = ResultOf<typeof GET_ROUTE_VIDEO>

export type WatchExperience = WatchData["experiences"][number]
type WatchSetting = WatchSettingsData["watchSetting"]
type RouteVideoRecord = RouteVideoData["videos"][number]

export type ExperienceMetadata = {
  title: string
  description: string
  ogTitle: string
  ogDescription: string
  pathSegment: string | null
  ogImage: {
    url: string
    width: number | null
    height: number | null
    alt: string
  } | null
}

export type RouteVideo = {
  documentId: string
  slug: string
  title: string
  snippet: string | null
  description: string | null
  noIndex: boolean
  imageUrl: string | null
  imageAlt: string | null
  streamingUrl: string | null
  relatedItems: EnrichedMediaItem[]
}

export type ResolvedWatchPage =
  | { kind: "experience"; experience: NonNullable<WatchExperience> }
  | {
      kind: "video-template"
      template: NonNullable<WatchExperience>
      routeVideo: RouteVideo
    }

export type WatchPageResult =
  | { data: ResolvedWatchPage; error: null }
  | { data: null; error: ErrorLike | Error }

const NO_EXPERIENCE_FOUND_MESSAGE = "No experience found"
const INVALID_HOMEPAGE_EXPERIENCE_MESSAGE =
  "Homepage experience must not be marked as template."
const INVALID_DEFAULT_TEMPLATE_MESSAGE =
  "Default template experience must be marked as template."

/** Maps a WatchExperience to metadata shape. Returns null if no usable title/description. */
export function experienceToMetadata(
  exp: WatchExperience | null,
): ExperienceMetadata | null {
  if (!exp) return null
  const title = exp.title ?? ""
  const description = exp.metaDescription ?? ""
  const ogTitle = exp.ogTitle ?? title
  const ogDescription = exp.ogDescription ?? description
  if (!title && !description) return null
  return {
    title,
    description,
    ogTitle,
    ogDescription,
    pathSegment: exp.pathSegment ?? null,
    ogImage: exp.ogImage
      ? {
          url: exp.ogImage.url,
          width: exp.ogImage.width ?? null,
          height: exp.ogImage.height ?? null,
          alt: exp.ogImage.alternativeText ?? "",
        }
      : null,
  }
}

export async function readPublishedContent(slug: string, locale: string) {
  const result = await client.query({
    query: GET_EXPERIENCE,
    variables: { slug, locale },
  })
  if (result.error) return null
  const items = result.data?.experiences
  return items?.[0] ?? null
}

export type Section = Exclude<
  NonNullable<NonNullable<NonNullable<WatchExperience>["blocks"]>[number]>,
  null | { __typename: "Error" }
>

export function isWatchPageMissingError(
  error: ErrorLike | Error | null | undefined,
): boolean {
  return error?.message?.trim() === NO_EXPERIENCE_FOUND_MESSAGE
}

function graphqlError(result: {
  error?: ErrorLike | null
  errors?: unknown[] | undefined
}): ErrorLike | Error | null {
  const graphqlErrors = result.errors?.filter(
    (entry): entry is { message?: string } =>
      typeof entry === "object" && entry !== null,
  )
  if (graphqlErrors?.length) {
    const message = graphqlErrors
      .map((entry) => entry.message ?? "Unknown")
      .join("; ")
    return new Error(message)
  }

  if (!result.error) return null

  const message =
    "message" in result.error && typeof result.error.message === "string"
      ? result.error.message
      : ""

  return message ? result.error : new Error("An unexpected error occurred.")
}

function asNonTemplateExperience(
  experience: WatchExperience | null | undefined,
): NonNullable<WatchExperience> | null {
  if (!experience || experience.isTemplate === true) return null
  return experience as NonNullable<WatchExperience>
}

function asTemplateExperience(
  experience: WatchExperience | null | undefined,
): NonNullable<WatchExperience> | null {
  if (!experience || experience.isTemplate !== true) return null
  return experience as NonNullable<WatchExperience>
}

async function getExperienceByFilters(
  locale: string,
  filters: Record<string, unknown>,
): Promise<NonNullable<WatchExperience> | null> {
  const result = await client.query({
    query: GET_WATCH_EXPERIENCE,
    variables: { locale, filters },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return (result.data?.experiences?.[0] ??
    null) as NonNullable<WatchExperience> | null
}

// ---------------------------------------------------------------------------
// U5 (feat-104) — dual-read parity canary for the slug-page Experience
//
// `fetchSlugExperience` is the inner branch site for the canary. It is
// called only from `resolveSlugPage`'s slug-equality case. The homepage
// path (`resolveHomepage`) and the legacy-homepage call still use
// `getExperienceByFilters` directly — out of U5 scope.
//
// Modes (read once at module scope from FORGE_CONTENT_API):
//   - strapi (default): identical to `getExperienceByFilters(locale,
//     { slug: { eq: slug } })`. Byte-identical to current `main`.
//   - dual-read: runs Strapi + admin in parallel via Promise.all,
//     hands both outcomes to the parity bridge for diff logging,
//     returns Strapi to the user. Admin failures/timeouts NEVER
//     affect user-facing render.
//
// Retire alongside the rest of U5's scaffolding. See:
//   apps/web/src/lib/content-api-mode.ts (deletion checklist)
// ---------------------------------------------------------------------------

// IMPORTANT: this fetcher only ever produces `ok: true` or `ok: "error"`.
// The SideOutcome union also admits `ok: "timeout"` (used by the admin
// side); if you add timeout classification to Strapi here, also add the
// matching branch to parity-bridge.ts's runDualReadComparison branch
// table — otherwise (strapi:timeout, admin:true) silently falls through
// to the unreachable narrowing return at the bottom of the bridge.
async function fetchStrapiSlugExperience(
  locale: string,
  slug: string,
): Promise<DualReadOutcome["strapi"]> {
  const start = performance.now()
  try {
    const response = await getExperienceByFilters(locale, {
      slug: { eq: slug },
    })
    return {
      ok: true,
      response: response ?? undefined,
      durationMs: Math.round(performance.now() - start),
    }
  } catch (error) {
    return {
      ok: "error",
      error,
      durationMs: Math.round(performance.now() - start),
    }
  }
}

// Match the typed AbortSignal.timeout / AbortController shapes the AWS-SDK-v3
// classification pattern recommends — error.name first, then cause.name, then
// Apollo Client v4's `networkError` surface (which wraps fetch-link errors
// and may itself carry the typed AbortSignal cause). No message-substring
// fallback: a real GraphQL error mentioning "timeout" would be misclassified
// as forge.parity.admin_timeout, polluting the canary's gating signal. See:
//   docs/solutions/runtime-errors/aws-s3-nosuchkey-classification-pattern-20260506.md
function isAbortTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (hasTimeoutOrAbortName(error)) return true
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error && hasTimeoutOrAbortName(cause)) return true
  // Apollo Client v4 surfaces transport errors via `error.networkError`.
  // The networkError itself or its cause may carry the typed shape.
  const networkError = (error as { networkError?: unknown }).networkError
  if (networkError instanceof Error) {
    if (hasTimeoutOrAbortName(networkError)) return true
    const networkCause = (networkError as { cause?: unknown }).cause
    if (networkCause instanceof Error && hasTimeoutOrAbortName(networkCause)) {
      return true
    }
  }
  return false
}

function hasTimeoutOrAbortName(error: Error): boolean {
  return error.name === "TimeoutError" || error.name === "AbortError"
}

async function fetchAdminSlugExperience(
  locale: string,
  slug: string,
): Promise<DualReadOutcome["admin"]> {
  const start = performance.now()
  const elapsed = () => Math.round(performance.now() - start)
  try {
    const result = await adminClient.query({
      query: adminExperienceBySlugOperation,
      variables: { locale, slug },
      fetchPolicy: "no-cache",
    })
    if (result.error) {
      if (isAbortTimeoutError(result.error)) {
        return { ok: "timeout", durationMs: elapsed() }
      }
      return { ok: "error", error: result.error, durationMs: elapsed() }
    }
    return {
      ok: true,
      response: result.data?.experienceBySlug ?? undefined,
      durationMs: elapsed(),
    }
  } catch (error) {
    if (isAbortTimeoutError(error)) {
      return { ok: "timeout", durationMs: elapsed() }
    }
    return { ok: "error", error, durationMs: elapsed() }
  }
}

async function fetchSlugExperience(
  locale: string,
  slug: string,
): Promise<NonNullable<WatchExperience> | null> {
  const mode = getContentApiMode()
  if (mode === "strapi") {
    return getExperienceByFilters(locale, { slug: { eq: slug } })
  }

  // dual-read: parallel fetch, log diff, serve Strapi.
  const [strapiOutcome, adminOutcome] = await Promise.all([
    fetchStrapiSlugExperience(locale, slug),
    fetchAdminSlugExperience(locale, slug),
  ])

  // Bridge swallows harness errors and emits structured logs internally,
  // but a sync throw at the bridge boundary (circular ref in payload,
  // throwing toString on a proxy field, JSON.stringify failure on BigInt)
  // would bubble out and break the user-facing render despite Strapi
  // having already succeeded. Defense-in-depth: the canary must NEVER
  // affect the user's response. Catch any such throw and emit a
  // structured forge.parity.canary_failed log line so operators can see
  // it, then continue and serve Strapi as planned.
  try {
    runDualReadComparison({
      slug,
      urlLocale: locale,
      strapi: strapiOutcome,
      admin: adminOutcome,
    })
  } catch (canaryErr) {
    if (typeof console !== "undefined") {
      console.log(
        JSON.stringify({
          event: "forge.parity.canary_failed",
          route: "[slug]",
          slug,
          locale,
          // Match the ParityLogPayload contract — every other parity event
          // carries timings; canary_failed must too so dashboards filtering
          // on timings.* don't see undefined on this branch.
          timings: {
            strapiMs: strapiOutcome.durationMs,
            adminMs: adminOutcome.durationMs,
          },
          errorMessage:
            canaryErr instanceof Error ? canaryErr.message : String(canaryErr),
        }),
      )
    }
  }

  // User-facing source is always Strapi in dual-read.
  if (strapiOutcome.ok === true) {
    return (strapiOutcome.response ??
      null) as NonNullable<WatchExperience> | null
  }
  if (strapiOutcome.ok === "error") {
    throw strapiOutcome.error
  }
  // Exhaustive default for the SideOutcome union. Strapi's `client.ts`
  // 10s AbortSignal surfaces as ok:"error" (not ok:"timeout") because
  // fetchStrapiSlugExperience does not classify timeout vs error — only
  // the admin side does. This branch is unreachable today; kept for
  // type-narrowing safety if the union ever gains a new variant.
  throw new Error("fetchSlugExperience: Strapi side returned no value")
}

async function getWatchSettings(locale: string): Promise<WatchSetting | null> {
  const result = await client.query({
    query: GET_WATCH_SETTINGS,
    variables: { locale },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return result.data?.watchSetting ?? null
}

async function getVideoBySlug(
  locale: string,
  slug: string,
): Promise<RouteVideoRecord | null> {
  const result = await client.query({
    query: GET_ROUTE_VIDEO,
    variables: { locale, slug },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return (result.data?.videos?.[0] ?? null) as RouteVideoRecord | null
}

function selectPlayableVariant(video: NonNullable<RouteVideoRecord>) {
  const variants = (video.variants ?? []).filter(
    (variant): variant is NonNullable<typeof variant> => variant != null,
  )

  const playableVariants = variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )
  if (!playableVariants.length) return null

  const primaryLanguageId = video.primaryLanguage?.coreId ?? null
  if (primaryLanguageId) {
    const primaryVariant = playableVariants.find(
      (variant) => variant.language?.coreId === primaryLanguageId,
    )
    if (primaryVariant) return primaryVariant
  }

  return playableVariants[0] ?? null
}

function normalizeRelatedRouteItems(
  video: NonNullable<RouteVideoRecord>,
): EnrichedMediaItem[] {
  const selfDocumentId = video.documentId
  const selfSlug = video.slug ?? null

  return (video.children ?? [])
    .filter((child): child is NonNullable<typeof child> => child != null)
    .filter((child) => {
      if (child.documentId === selfDocumentId) return false
      if (selfSlug && child.slug === selfSlug) return false
      return true
    })
    .map(enrichRouteRelatedVideo)
    .filter((item): item is EnrichedMediaItem => item != null)
    .slice(0, 24)
}

function normalizeRouteVideo(
  video: NonNullable<RouteVideoRecord>,
): RouteVideo | null {
  const selectedVariant = selectPlayableVariant(video)
  if (!selectedVariant?.hls) return null

  return {
    documentId: video.documentId,
    slug: video.slug ?? "",
    title: video.title ?? "",
    snippet: video.snippet ?? null,
    description: video.description ?? null,
    noIndex: video.noIndex ?? false,
    imageUrl: video.images?.[0]?.url ?? null,
    imageAlt: video.imageAlt ?? null,
    streamingUrl: selectedVariant.hls ?? null,
    relatedItems: normalizeRelatedRouteItems(video),
  }
}

async function resolveHomepage(
  locale: string,
): Promise<ResolvedWatchPage | null> {
  const settings = await getWatchSettings(locale)
  if (settings?.homepageExperience?.isTemplate === true) {
    throw new Error(INVALID_HOMEPAGE_EXPERIENCE_MESSAGE)
  }

  const homepageExperience = asNonTemplateExperience(
    settings?.homepageExperience ?? null,
  )
  if (homepageExperience) {
    return { kind: "experience", experience: homepageExperience }
  }

  const legacyHomepage = asNonTemplateExperience(
    await getExperienceByFilters(locale, {
      isHomepage: { eq: true },
    }),
  )
  if (!legacyHomepage) return null

  return { kind: "experience", experience: legacyHomepage }
}

async function resolveSlugPage(
  locale: string,
  slug: string,
): Promise<ResolvedWatchPage | null> {
  // U5 — slug-page Experience branch goes through fetchSlugExperience so
  // dual-read mode can fan out to admin in shadow. Behavior in `strapi`
  // mode (default) is identical to the previous direct call.
  const explicitExperience = asNonTemplateExperience(
    await fetchSlugExperience(locale, slug),
  )
  if (explicitExperience) {
    return { kind: "experience", experience: explicitExperience }
  }

  const routeVideoRecord = await getVideoBySlug(locale, slug)
  if (!routeVideoRecord) return null

  const settings = await getWatchSettings(locale)
  if (
    settings?.defaultTemplateExperience &&
    settings.defaultTemplateExperience.isTemplate !== true
  ) {
    throw new Error(INVALID_DEFAULT_TEMPLATE_MESSAGE)
  }

  const templateExperience = asTemplateExperience(
    settings?.defaultTemplateExperience ?? null,
  )
  if (!templateExperience) return null

  const routeVideo = normalizeRouteVideo(routeVideoRecord)
  if (!routeVideo?.streamingUrl) return null

  return {
    kind: "video-template",
    template: templateExperience,
    routeVideo,
  }
}

const fetchResolvedWatchPage = unstable_cache(
  async (
    locale: string,
    slugOrNull: string | null,
  ): Promise<WatchPageResult> => {
    try {
      const resolved =
        slugOrNull === null
          ? await resolveHomepage(locale)
          : await resolveSlugPage(locale, slugOrNull)

      if (!resolved) {
        return { data: null, error: new Error(NO_EXPERIENCE_FOUND_MESSAGE) }
      }

      return {
        data: JSON.parse(JSON.stringify(resolved)) as ResolvedWatchPage,
        error: null,
      }
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  },
  ["watch-page"],
  { revalidate: 60 },
)

/** Shared watch-page resolver for page rendering and metadata generation. */
export const resolveWatchPage = cache(
  async (locale: string, slug?: string): Promise<WatchPageResult> => {
    return fetchResolvedWatchPage(locale, slug ?? null)
  },
)

// ---------------------------------------------------------------------------
// U3: dedicated watch route resolver
// ---------------------------------------------------------------------------

type GetWatchVideoData = ResultOf<typeof getWatchVideoOperation>
type WatchVideoRecord = NonNullable<GetWatchVideoData["videos"][number]>
type WatchParent = NonNullable<NonNullable<WatchVideoRecord["parents"]>[number]>
type WatchVariant = NonNullable<
  NonNullable<WatchVideoRecord["variants"]>[number]
>

export type WatchVideoErrorCode =
  | "PARENT_NOT_FOUND"
  | "LOCALE_NOT_FOUND"
  | "NO_PLAYABLE_VARIANT"
  | "VIDEO_NOT_FOUND"
  | "INVALID_HERO_PLAYER_BLOCK"

/**
 * Typed error surfaced from `resolveWatchVideo` (and `mergeWatchExperience`)
 * when the requested collection/video/locale combination cannot be rendered,
 * or when an Experience supplies a Strapi-typed player block targeting the
 * watch-page HeroPlayer slot. The route layer
 * (`apps/web/src/app/[slug]/[video]/[locale]/page.tsx`) re-throws this so the
 * sibling `error.tsx` boundary can map the code to copy.
 *
 * `INVALID_HERO_PLAYER_BLOCK` is thrown by `mergeWatchExperience` and may not
 * have request-scope fields, so collectionSlug/videoSlug/languageSlug are
 * optional and default to empty strings when omitted.
 */
export class WatchVideoError extends Error {
  readonly code: WatchVideoErrorCode
  readonly collectionSlug: string
  readonly videoSlug: string
  readonly languageSlug: string

  constructor(
    code: WatchVideoErrorCode,
    {
      collectionSlug,
      videoSlug,
      languageSlug,
      cause,
      message,
    }: {
      collectionSlug?: string
      videoSlug?: string
      languageSlug?: string
      cause?: unknown
      message?: string
    } = {},
  ) {
    super(message ?? `watch-video:${code}`, cause ? { cause } : undefined)
    this.name = "WatchVideoError"
    this.code = code
    this.collectionSlug = collectionSlug ?? ""
    this.videoSlug = videoSlug ?? ""
    this.languageSlug = languageSlug ?? ""
  }
}

/**
 * Resolved payload for `/watch/[collection]/[video]/[locale]`.
 *
 * The `video` field carries the full Strapi projection from
 * `WatchVideoFragment`; `canonicalParent` and `selectedVariant` are
 * resolver-side picks (URL slug match + language.slug filter) and are
 * **also referenced by the same identity inside `video.parents` /
 * `video.variants`** so downstream consumers can correlate without a second
 * lookup.
 */
export type ResolvedWatchVideo = {
  video: WatchVideoRecord
  canonicalParent: WatchParent
  selectedVariant: WatchVariant
}

type ResolveWatchVideoArgs = {
  collectionSlug: string
  videoSlug: string
  languageSlug: string
}

const WATCH_VIDEO_I18N_LOCALE = "en"

async function fetchWatchVideoRecord(
  collectionSlug: string,
  videoSlug: string,
): Promise<WatchVideoRecord | null> {
  const result = await client.query({
    query: getWatchVideoOperation,
    variables: {
      i18nLocale: WATCH_VIDEO_I18N_LOCALE,
      collectionSlug,
      videoSlug,
    },
    fetchPolicy: "no-cache",
  })

  const error = graphqlError(
    result as { error?: ErrorLike; errors?: unknown[] },
  )
  if (error) throw error

  return (result.data?.videos?.[0] ?? null) as WatchVideoRecord | null
}

// Strip the heavy fields (`downloads`, `muxVideo`, `duration`) from every
// variant in `record.variants` *except* the one matching `selectedDocumentId`.
// Each non-selected variant retains documentId, slug, published, hls, and
// language only — enough to power the language picker and the URL/locale
// guards without shipping ~2KB of MP4 download metadata × 240+ variants.
//
// Runtime-only narrowing: the `WatchVideoRecord` type still claims those
// fields are present on every variant, so we cast through `unknown` to keep
// the public type stable. Consumers that reach for `variant.downloads` on a
// non-selected variant will see `undefined` — that's the cost we pay for
// keeping the RSC payload sub-100KB instead of the original ~500KB.
function stripNonSelectedVariantFields(
  record: WatchVideoRecord,
  selectedDocumentId: string | null,
): WatchVideoRecord {
  if (!record.variants?.length) return record
  const variants = record.variants.map((variant) => {
    if (variant == null) return variant
    if (variant.documentId === selectedDocumentId) return variant
    return {
      documentId: variant.documentId,
      slug: variant.slug,
      published: variant.published,
      hls: variant.hls,
      language: variant.language,
    } as unknown as typeof variant
  })
  return { ...record, variants } as WatchVideoRecord
}

async function tryResolveWatchVideo(
  collectionSlug: string,
  videoSlug: string,
  languageSlug: string,
): Promise<ResolvedWatchVideo> {
  const record = await fetchWatchVideoRecord(collectionSlug, videoSlug)
  if (!record) {
    throw new WatchVideoError("VIDEO_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const parents = (record.parents ?? []).filter(
    (parent): parent is WatchParent => parent != null,
  )
  const canonicalParent =
    parents.find((parent) => parent.slug === collectionSlug) ?? null
  if (!canonicalParent) {
    throw new WatchVideoError("PARENT_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const variants = (record.variants ?? []).filter(
    (variant): variant is WatchVariant => variant != null,
  )
  const playableVariants = variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )

  const selectedVariant =
    playableVariants.find(
      (variant) => variant.language?.slug === languageSlug,
    ) ?? null

  if (!selectedVariant) {
    // Distinguish "language not in this video" vs. "no playable variant at
    // all" so the error boundary can show a useful English-fallback link.
    const matchedLanguageVariant = variants.find(
      (variant) => variant.language?.slug === languageSlug,
    )
    if (!playableVariants.length) {
      throw new WatchVideoError("NO_PLAYABLE_VARIANT", {
        collectionSlug,
        videoSlug,
        languageSlug,
      })
    }
    // Either the requested language has a variant but it's unpublished or
    // missing HLS, or the language is absent entirely. Both surface as
    // LOCALE_NOT_FOUND — error.tsx handles fallback link.
    void matchedLanguageVariant
    throw new WatchVideoError("LOCALE_NOT_FOUND", {
      collectionSlug,
      videoSlug,
      languageSlug,
    })
  }

  const narrowedRecord = stripNonSelectedVariantFields(
    record,
    selectedVariant.documentId,
  )

  const resolved: ResolvedWatchVideo = {
    video: narrowedRecord,
    canonicalParent,
    selectedVariant,
  }

  // Match resolveWatchPage's plain-data normalization so the result is safe
  // to serialize across the RSC boundary.
  return JSON.parse(JSON.stringify(resolved)) as ResolvedWatchVideo
}

const fetchResolvedWatchVideo = unstable_cache(
  tryResolveWatchVideo,
  ["watch-video"],
  { revalidate: 60 },
)

/**
 * Resolve the dedicated watch-page payload for `/watch/[collection]/[video]/[locale]`.
 *
 * Throws `WatchVideoError` with a typed `code` when the request cannot be
 * rendered. The caller (server component or `generateMetadata`) decides how
 * to surface that — typically by re-throwing for `error.tsx` to map.
 */
export const resolveWatchVideo = cache(
  async ({
    collectionSlug,
    videoSlug,
    languageSlug,
  }: ResolveWatchVideoArgs): Promise<ResolvedWatchVideo> => {
    return fetchResolvedWatchVideo(collectionSlug, videoSlug, languageSlug)
  },
)

// canonicalParent is null when the video has no parent (2-segment URL has no
// collection slug — picks parents[0] as canonical, or null if parents empty).
export type ResolvedWatchVideoBySlug = {
  video: WatchVideoRecord
  canonicalParent: WatchParent | null
  selectedVariant: WatchVariant
}

// React `cache()`-wrapped so that resolveWatchVideoBySlug and
// resolveSeriesBySlug, which both delegate to this fetch, dedupe to a
// single HTTP round-trip within one RSC render pass. Without this
// wrapper the trailerless-series cold path makes two sequential Strapi
// calls (each with its own 10 s AbortSignal budget) before falling
// through to resolveWatchPage. unstable_cache around the outer
// resolvers does NOT dedupe across them — each resolver has its own
// cache-key namespace, so the deduplication has to live at the inner
// fetch instead.
const fetchWatchVideoBySlug = cache(
  async (videoSlug: string): Promise<WatchVideoRecord | null> => {
    const result = await client.query({
      query: getWatchVideoBySlugOperation,
      variables: {
        i18nLocale: WATCH_VIDEO_I18N_LOCALE,
        videoSlug,
      },
      fetchPolicy: "no-cache",
    })

    const error = graphqlError(
      result as { error?: ErrorLike; errors?: unknown[] },
    )
    if (error) throw error

    return (result.data?.videos?.[0] ?? null) as WatchVideoRecord | null
  },
)

// Sentinel thrown by the cached inner so unstable_cache never persists a
// "no playable variant" miss. unstable_cache re-throws on error and does
// NOT cache failures — the outer wrapper catches this sentinel and returns
// null, while real downstream errors propagate as before.
const WATCH_VIDEO_BY_SLUG_NOT_FOUND = "watch-video-by-slug:NOT_FOUND"

async function tryResolveWatchVideoBySlug(
  videoSlug: string,
  locale: string,
): Promise<ResolvedWatchVideoBySlug> {
  const record = await fetchWatchVideoBySlug(videoSlug)
  if (!record) throw new Error(WATCH_VIDEO_BY_SLUG_NOT_FOUND)

  const parents = (record.parents ?? []).filter(
    (parent): parent is WatchParent => parent != null,
  )
  const canonicalParent = parents[0] ?? null

  const variants = (record.variants ?? []).filter(
    (variant): variant is WatchVariant => variant != null,
  )
  const playableVariants = variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )
  if (!playableVariants.length) throw new Error(WATCH_VIDEO_BY_SLUG_NOT_FOUND)

  // Priority: URL locale (slug → bcp47), then primary, then first playable.
  const localeMatch =
    playableVariants.find((variant) => variant.language?.slug === locale) ??
    playableVariants.find((variant) => variant.language?.bcp47 === locale)
  const primaryLanguageId = record.primaryLanguage?.coreId ?? null
  const primaryMatch = primaryLanguageId
    ? playableVariants.find(
        (variant) => variant.language?.coreId === primaryLanguageId,
      )
    : null
  const selectedVariant =
    localeMatch ?? primaryMatch ?? playableVariants[0] ?? null
  if (!selectedVariant) throw new Error(WATCH_VIDEO_BY_SLUG_NOT_FOUND)

  const narrowedRecord = stripNonSelectedVariantFields(
    record,
    selectedVariant.documentId,
  )

  const resolved: ResolvedWatchVideoBySlug = {
    video: narrowedRecord,
    canonicalParent,
    selectedVariant,
  }
  return JSON.parse(JSON.stringify(resolved)) as ResolvedWatchVideoBySlug
}

// Cache wraps only the success path. unstable_cache re-throws errors and does
// NOT cache them, so the NOT_FOUND sentinel naturally bypasses the cache —
// each request re-queries Strapi until a record exists. This avoids pinning
// a 60s "null" entry in the cache for a record that just hasn't been
// published yet (the original bug).
const fetchResolvedWatchVideoBySlug = unstable_cache(
  tryResolveWatchVideoBySlug,
  ["watch-video-by-slug"],
  { revalidate: 60 },
)

// Returns null when the slug doesn't match a record OR the video has no
// playable variant (published + hls). Caller falls through to Experience.
export const resolveWatchVideoBySlug = cache(
  async (
    videoSlug: string,
    locale: string,
  ): Promise<ResolvedWatchVideoBySlug | null> => {
    try {
      return await fetchResolvedWatchVideoBySlug(videoSlug, locale)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === WATCH_VIDEO_BY_SLUG_NOT_FOUND
      ) {
        return null
      }
      throw error
    }
  },
)

// ---------------------------------------------------------------------------
// Series-shaped resolver (R2, U1) — accepts records that the canonical
// resolveWatchVideoBySlug rejects (no playable variant). Used by the series
// details page when a slug points at a parent record (collection / series).
//
// The discriminator is intentionally defensive (case-insensitive label match
// against the known series-shaped enum values, OR null label with children
// present). The U1 plan called for a one-off admin-data verification before
// locking a single value, but the existing resolver targets Strapi (whose
// generated enum is lowercase camelCase: `collection`, `series`) while admin
// uses uppercase (`COLLECTION`, `SERIES`). The defensive OR survives either
// shape and degrades gracefully for editor records that pre-date the label
// taxonomy.
// ---------------------------------------------------------------------------

export type ResolvedSeriesBySlug = {
  video: WatchVideoRecord
  selectedVariant: WatchVariant | null
}

// Explicit `Set<string>` annotation so the deliberate widening to string
// (to accept admin-uppercase labels via the `String(label).toLowerCase()`
// normalization below) is declared on the container, not buried in the
// call-site cast. Without this annotation the Set is inferred as
// `Set<"collection" | "series">` and a future typo in the contents
// (e.g. `"collectionn"`) would still pass the literal-union check.
const SERIES_LABEL_VALUES = new Set<string>(["collection", "series"])

// Consumed by `apps/web/src/app/[slug]/[locale]/page.tsx` (routing
// branch + `generateMetadata`) AND by unit tests that exercise the
// discriminator without standing up Apollo.
export function isSeriesRecord(record: WatchVideoRecord): boolean {
  const label = record.label
  if (label) return SERIES_LABEL_VALUES.has(String(label).toLowerCase())
  return (record.children?.length ?? 0) > 0
}

const SERIES_BY_SLUG_NOT_FOUND = "series-by-slug:NOT_FOUND"

async function tryResolveSeriesBySlug(
  videoSlug: string,
  locale: string,
): Promise<ResolvedSeriesBySlug> {
  // Reuses the same HTTP fetch the canonical video resolver uses, so a
  // COLLECTION-without-trailer slug never costs two admin round-trips —
  // unstable_cache wraps the per-resolver outer, fetchWatchVideoBySlug
  // is the shared HTTP call site.
  const record = await fetchWatchVideoBySlug(videoSlug)
  if (!record) throw new Error(SERIES_BY_SLUG_NOT_FOUND)
  if (!isSeriesRecord(record)) throw new Error(SERIES_BY_SLUG_NOT_FOUND)

  const variants = (record.variants ?? []).filter(
    (variant): variant is WatchVariant => variant != null,
  )
  // hls is the canonical playability discriminator (see Key Technical
  // Decisions): a variant with muxVideo.playbackId but no hls is treated
  // as unplayable because <MuxPlayer> consumes hls for streaming.
  const playableVariants = variants.filter(
    (variant) => variant.published === true && Boolean(variant.hls),
  )

  let selectedVariant: WatchVariant | null = null
  if (playableVariants.length) {
    const localeMatch =
      playableVariants.find((variant) => variant.language?.slug === locale) ??
      playableVariants.find((variant) => variant.language?.bcp47 === locale)
    const primaryLanguageId = record.primaryLanguage?.coreId ?? null
    const primaryMatch = primaryLanguageId
      ? playableVariants.find(
          (variant) => variant.language?.coreId === primaryLanguageId,
        )
      : null
    selectedVariant = localeMatch ?? primaryMatch ?? playableVariants[0] ?? null
  }

  const narrowedRecord = selectedVariant
    ? stripNonSelectedVariantFields(record, selectedVariant.documentId)
    : record

  const resolved: ResolvedSeriesBySlug = {
    video: narrowedRecord,
    selectedVariant,
  }
  return JSON.parse(JSON.stringify(resolved)) as ResolvedSeriesBySlug
}

const fetchResolvedSeriesBySlug = unstable_cache(
  tryResolveSeriesBySlug,
  ["series-by-slug"],
  { revalidate: 60 },
)

// Returns null when the slug doesn't match a record OR the record is not
// series-shaped. Caller falls through to resolveWatchPage / Experience.
export const resolveSeriesBySlug = cache(
  async (
    videoSlug: string,
    locale: string,
  ): Promise<ResolvedSeriesBySlug | null> => {
    try {
      return await fetchResolvedSeriesBySlug(videoSlug, locale)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === SERIES_BY_SLUG_NOT_FOUND
      ) {
        return null
      }
      throw error
    }
  },
)

// ---------------------------------------------------------------------------
// U4: Hybrid resolver — synthetic watch blocks + per-block-type override merge
// ---------------------------------------------------------------------------

type WatchStudyQuestion = NonNullable<
  NonNullable<WatchVideoRecord["studyQuestions"]>[number]
>
type WatchBibleCitation = NonNullable<
  NonNullable<WatchVideoRecord["bibleCitations"]>[number]
>

/**
 * Synthetic block-type discriminators owned by the watch route. These are NOT
 * Strapi `__typename` values — they exist purely so `WatchSectionRenderer` can
 * dispatch watch-only components (HeroPlayer, SiblingCarousel, WatchBody,
 * StudyQuestions, BibleQuotes, Share) alongside Strapi-typed blocks coming
 * out of an optional Experience.
 *
 * The `kind` field is the discriminator. We deliberately avoid `__typename`
 * to make it impossible to confuse a synthetic block with a Strapi one in
 * the renderer switch.
 */
export type WatchHeroPlayerBlock = {
  kind: "HeroPlayer"
  video: WatchVideoRecord
  variant: WatchVariant
}

/**
 * Structural subtype shared between the canonical-parent and
 * synthesized-from-current-video carousel sources. Captures the exact set
 * of fields the carousel UI reads, so the virtualParent literal in
 * `buildSiblingCarouselBlock` satisfies the type without an `as` cast or
 * a cross-path filter assertion.
 */
export type CarouselParent = {
  documentId: string
  slug: string | null
  title: string | null
  children: NonNullable<WatchParent["children"]>
}

export type WatchSiblingCarouselBlock = {
  kind: "SiblingCarousel"
  canonicalParent: CarouselParent
  currentVideoDocumentId: string
}

export type WatchBodyBlock = {
  kind: "WatchBody"
  video: WatchVideoRecord
  variant: WatchVariant
}

export type WatchStudyQuestionsBlock = {
  kind: "StudyQuestions"
  studyQuestions: WatchStudyQuestion[]
}

export type WatchBibleQuotesBlock = {
  kind: "BibleQuotes"
  bibleCitations: WatchBibleCitation[]
}

export type WatchShareBlock = {
  kind: "Share"
  video: WatchVideoRecord
}

export type WatchBlock =
  | WatchHeroPlayerBlock
  | WatchSiblingCarouselBlock
  | WatchBodyBlock
  | WatchStudyQuestionsBlock
  | WatchBibleQuotesBlock
  | WatchShareBlock

/** Strapi-typed block coming from an Experience (matches `Section`). */
export type StrapiWatchBlock = Section

/** Discriminator for entries in the merged watch-block array. */
export type MergedWatchBlock = WatchBlock | StrapiWatchBlock

/**
 * Strapi `__typename` values that mount their own player and would steal Mux
 * Data attribution from the watch-page HeroPlayer. These are rejected at
 * merge time when targeting the HeroPlayer slot.
 */
const PLAYER_BEARING_STRAPI_TYPES = new Set<string>([
  "ComponentSectionsVideoHero",
  "ComponentSectionsVideo",
  "ComponentSectionsVideoCarousel",
])

const HERO_PLAYER_REJECTION_MESSAGE =
  "HeroPlayer slot accepts only the watch-page Mux Player; use the auto-template HeroPlayer or override a different slot."

// Auto-template builders ------------------------------------------------------

/** Always returns a HeroPlayer block — the page is unrenderable without one. */
export function buildHeroBlock(
  video: WatchVideoRecord,
  variant: WatchVariant,
): WatchHeroPlayerBlock {
  return { kind: "HeroPlayer", video, variant }
}

/**
 * Returns a carousel block with the most relevant peer set, or null when none
 * is available:
 *
 * 1. When the current video has its **own** children (a parent / collection
 *    video like JESUS with 61 chapter segments), surface those — the user is
 *    looking at the parent, so chapters are the relevant peers.
 * 2. Otherwise, fall back to the canonical parent's children — the current
 *    video is itself a chapter, and the user wants to navigate between
 *    siblings of the same parent (e.g. between segments of JESUS).
 *
 * Returns null when neither source has at least 2 entries.
 */
export function buildSiblingCarouselBlock(
  canonicalParent: WatchParent | null,
  video: WatchVideoRecord,
): WatchSiblingCarouselBlock | null {
  // Narrow nulls only — both the parent's children and the current video's
  // children share the same element type at the schema level, so we don't
  // need a cross-path type assertion (each branch's narrow already lands
  // inside `CarouselParent.children`).
  const ownChildren = (video.children ?? []).filter(
    (child): child is NonNullable<typeof child> => child != null,
  )
  if (ownChildren.length >= 2) {
    // Synthesize a virtual parent from the current video so the carousel's
    // header reads correctly ("JESUS · Clip N of M") and so the existing
    // canonicalParent.children consumer in <SiblingCarousel> doesn't need a
    // second branch. `currentVideoDocumentId` won't match any of its own
    // children, so no "Playing now" badge — accurate for a parent-page view.
    const virtualParent: CarouselParent = {
      documentId: video.documentId,
      slug: video.slug ?? "",
      title: video.title ?? "",
      children: ownChildren,
    }
    return {
      kind: "SiblingCarousel",
      canonicalParent: virtualParent,
      currentVideoDocumentId: video.documentId,
    }
  }
  if (!canonicalParent) return null
  const siblings = (canonicalParent.children ?? []).filter(
    (child): child is NonNullable<typeof child> => child != null,
  )
  if (siblings.length < 2) return null
  return {
    kind: "SiblingCarousel",
    canonicalParent: {
      documentId: canonicalParent.documentId,
      slug: canonicalParent.slug ?? null,
      title: canonicalParent.title ?? null,
      children: siblings,
    },
    currentVideoDocumentId: video.documentId,
  }
}

/** Always returns a WatchBody block — the page always shows title + description. */
export function buildWatchBodyBlock(
  video: WatchVideoRecord,
  variant: WatchVariant,
): WatchBodyBlock {
  return { kind: "WatchBody", video, variant }
}

/** Returns null when the video has no study questions. */
export function buildStudyQuestionsBlock(
  studyQuestions: WatchVideoRecord["studyQuestions"],
): WatchStudyQuestionsBlock | null {
  const items = (studyQuestions ?? []).filter(
    (q): q is WatchStudyQuestion => q != null,
  )
  if (items.length === 0) return null
  return { kind: "StudyQuestions", studyQuestions: items }
}

/**
 * Always returns a BibleQuotes block — every watch page surfaces the carousel
 * (the trailing "Join Our Bible Study" promo card is the always-on CTA).
 * `bibleCitations` may be empty; the section still renders the promo card.
 */
export function buildBibleQuotesBlock(
  bibleCitations: WatchVideoRecord["bibleCitations"],
): WatchBibleQuotesBlock {
  const items = (bibleCitations ?? []).filter(
    (c): c is WatchBibleCitation => c != null,
  )
  return { kind: "BibleQuotes", bibleCitations: items }
}

/** Always returns a Share block — every video is shareable. */
export function buildShareBlock(video: WatchVideoRecord): WatchShareBlock {
  return { kind: "Share", video }
}

// Slot mapping ----------------------------------------------------------------

/**
 * Slot identifiers for each of the 6 synthetic watch-block positions. Used
 * internally by `mergeWatchExperience` to decide which Experience-supplied
 * block (if any) overrides which auto-template builder.
 */
type WatchSlotKey =
  | "HeroPlayer"
  | "SiblingCarousel"
  | "WatchBody"
  | "StudyQuestions"
  | "BibleQuotes"
  | "Share"

/**
 * Maps an incoming Experience block (synthetic or Strapi-typed) to the
 * synthetic watch slot it fills, or `null` if the block does not target any
 * of the 6 slots and should pass through to delegated rendering.
 *
 * Slot mapping rules:
 * - Synthetic blocks fill the slot named by their `kind`.
 * - Strapi `ComponentSectionsRelatedQuestions` → StudyQuestions slot.
 * - Strapi `ComponentSectionsBibleQuotesCarousel` → BibleQuotes slot.
 * - All other Strapi blocks (PromoBanner, InfoBlocks, CTASection, etc.)
 *   pass through and render after the 6 watch slots.
 * - Strapi player-bearing blocks (VideoHero/Video/VideoCarousel) explicitly
 *   target HeroPlayer slot for the rejection check.
 */
function blockSlot(block: MergedWatchBlock): WatchSlotKey | null {
  if ("kind" in block) {
    return block.kind
  }
  const tn = block.__typename
  if (tn === "ComponentSectionsRelatedQuestions") return "StudyQuestions"
  if (tn === "ComponentSectionsBibleQuotesCarousel") return "BibleQuotes"
  if (PLAYER_BEARING_STRAPI_TYPES.has(tn)) return "HeroPlayer"
  return null
}

/**
 * Type guard distinguishing synthetic watch blocks from Strapi blocks.
 * Synthetic blocks carry a `kind` discriminator; Strapi blocks carry
 * `__typename`.
 */
export function isWatchBlock(block: MergedWatchBlock): block is WatchBlock {
  return "kind" in block
}

// Merge -----------------------------------------------------------------------

type MergeWatchExperienceArgs = {
  video: WatchVideoRecord
  variant: WatchVariant
  /**
   * Canonical parent for the sibling carousel. May be null when the watch
   * page is hit via the 2-segment URL `/watch/[video]/[locale]` (no
   * collection in the URL) AND the video has no parent at all. When null,
   * the SiblingCarousel slot is omitted from the merged block array.
   */
  canonicalParent: WatchParent | null
  /** Optional Experience override — when omitted, all 6 slots auto-template. */
  experience?: WatchExperience | null
}

/**
 * Merge an optional Experience override against the 6 auto-template watch
 * slots, returning the final ordered block array consumed by
 * `WatchSectionRenderer`.
 *
 * Behavior:
 * - For each of the 6 synthetic slots: if the Experience supplies a block
 *   targeting that slot, the override wins; else the slot's auto-template
 *   builder runs. Builders returning `null` (empty data) omit the slot.
 * - HeroPlayer slot is type-restricted: a Strapi-typed player-bearing block
 *   targeting HeroPlayer throws `WatchVideoError('INVALID_HERO_PLAYER_BLOCK')`.
 *   Only synthetic `HeroPlayer` overrides are accepted.
 * - Strapi blocks not targeting any of the 6 slots (PromoBanner, InfoBlocks,
 *   CTA, etc.) append after the 6 slots in the order the Experience supplied
 *   them.
 *
 * The returned array order matches the visual watch-page order:
 * HeroPlayer → SiblingCarousel → WatchBody → StudyQuestions → BibleQuotes →
 * Share → ...passthrough Strapi blocks.
 */
export function mergeWatchExperience({
  video,
  variant,
  canonicalParent,
  experience,
}: MergeWatchExperienceArgs): MergedWatchBlock[] {
  const overrides = new Map<WatchSlotKey, MergedWatchBlock>()
  const passthrough: StrapiWatchBlock[] = []

  const experienceBlocks = (experience?.blocks ?? []).filter(
    (b): b is StrapiWatchBlock => b != null && b.__typename !== "Error",
  )

  for (const block of experienceBlocks) {
    const slot = blockSlot(block)
    if (slot === "HeroPlayer" && !isWatchBlock(block)) {
      // HeroPlayer slot is type-restricted: only synthetic HeroPlayer blocks
      // are accepted. Any Strapi-typed player block reaching here is rejected
      // to preserve Mux Data attribution to the watch-page player.
      throw new WatchVideoError("INVALID_HERO_PLAYER_BLOCK", {
        message: HERO_PLAYER_REJECTION_MESSAGE,
      })
    }
    if (slot != null) {
      // Last-write-wins inside Experience for a given slot.
      overrides.set(slot, block)
    } else {
      passthrough.push(block)
    }
  }

  const result: MergedWatchBlock[] = []

  function pushSlot(slot: WatchSlotKey, fallback: MergedWatchBlock | null) {
    const override = overrides.get(slot)
    if (override !== undefined) {
      result.push(override)
      return
    }
    if (fallback !== null) result.push(fallback)
  }

  pushSlot("HeroPlayer", buildHeroBlock(video, variant))
  pushSlot("SiblingCarousel", buildSiblingCarouselBlock(canonicalParent, video))
  pushSlot("WatchBody", buildWatchBodyBlock(video, variant))
  pushSlot(
    "StudyQuestions",
    buildStudyQuestionsBlock(video.studyQuestions ?? null),
  )
  pushSlot("BibleQuotes", buildBibleQuotesBlock(video.bibleCitations ?? null))
  pushSlot("Share", buildShareBlock(video))

  for (const block of passthrough) result.push(block)

  return result
}
