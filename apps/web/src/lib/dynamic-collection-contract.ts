import { PUBLIC_WATCH_LANGUAGE_SLUGS } from "@forge/watch-url-policy/routes"

import { hasUiLocale } from "@/i18n/generated-ui-locales"

export const WATCH_COLLECTION_FEED_MAX_EXCLUSIONS = 200
export const WATCH_COLLECTION_FEED_MAX_URL_LENGTH = 8 * 1024
export const WATCH_COLLECTION_FEED_CACHE_SIGNATURE_PATTERN =
  /^[A-Za-z0-9_-]{43}$/

export const WATCH_COLLECTION_FEED_PROFILES = {
  mobile: { first: 2, cardsPerParent: 8 },
  desktop: { first: 3, cardsPerParent: 12 },
} as const

export type DynamicCollectionFeedProfile =
  (typeof WATCH_COLLECTION_FEED_PROFILES)[keyof typeof WATCH_COLLECTION_FEED_PROFILES]

export type DynamicCollectionFeedCacheScope = "live" | "preview"

export type DynamicCollectionFeedCacheSignatures = Record<
  keyof typeof WATCH_COLLECTION_FEED_PROFILES,
  string
>

export type DynamicCollectionFeedItem = {
  id: string
  coreId: string
  title: string
  videoSlug: string
  languageSlug: string | null
  label: string | null
  imageUrl: string | null
  blurDataUrl: string | null
  dominantColor: string | null
  muxPlaybackId: string | null
}

export type DynamicCollectionFeedSection = {
  id: string
  slug: string
  title: string
  description: string | null
  items: DynamicCollectionFeedItem[]
}

export type DynamicCollectionFeedPage = {
  sections: DynamicCollectionFeedSection[]
  endCursor: string | null
  hasNextPage: boolean
}

export type LoadedDynamicCollectionFeedPage = DynamicCollectionFeedPage & {
  nextCacheSignature: string | null
}

export type DynamicCollectionFeedInput = DynamicCollectionFeedProfile & {
  locale: string
  languageSlug: string
  cacheScope?: DynamicCollectionFeedCacheScope
  cacheSignature?: string | null
  after?: string | null
  excludedIds?: readonly string[]
  excludedSlugs?: readonly string[]
}

export type NormalizedDynamicCollectionFeedInput = {
  locale: string
  languageSlug: string
  cacheScope: DynamicCollectionFeedCacheScope
  cacheSignature: string | null
  after: string | null
  excludedIds: string[]
  excludedSlugs: string[]
  first: 2 | 3
  cardsPerParent: 8 | 12
}

export class DynamicCollectionFeedValidationError extends Error {
  constructor(
    readonly kind: "request" | "response",
    message: string,
  ) {
    super(message)
    this.name = "DynamicCollectionFeedValidationError"
  }
}

export class DynamicCollectionFeedRequestError extends Error {
  constructor(
    readonly code: "http" | "rate_limited" | "timeout" | "transport",
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(
      code === "rate_limited"
        ? "Collection feed request was rate limited"
        : code === "timeout"
          ? "Collection feed request timed out"
          : "Collection feed request failed",
    )
    this.name = "DynamicCollectionFeedRequestError"
  }
}

type DynamicCollectionFeedInputCandidate = Omit<
  DynamicCollectionFeedInput,
  "first" | "cardsPerParent"
> & {
  first: number
  cardsPerParent: number
}

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,191}$/
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,200}$/
const LANGUAGE_SLUG_PATTERN = /^[a-z0-9-]{1,100}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = new Set(keys)
  return Object.keys(value).every((key) => expected.has(key))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function normalizeReferences(values: readonly string[] | undefined): string[] {
  if ((values?.length ?? 0) > WATCH_COLLECTION_FEED_MAX_EXCLUSIONS) {
    throw new DynamicCollectionFeedValidationError(
      "request",
      "Invalid collection feed request",
    )
  }

  const normalized = (values ?? []).map((value) => value.trim())
  if (normalized.some((value) => !REFERENCE_PATTERN.test(value))) {
    throw new DynamicCollectionFeedValidationError(
      "request",
      "Invalid collection feed request",
    )
  }
  return [...new Set(normalized)].sort()
}

function isAllowedProfile(
  first: number,
  cardsPerParent: number,
): first is 2 | 3 {
  return (
    (first === WATCH_COLLECTION_FEED_PROFILES.mobile.first &&
      cardsPerParent ===
        WATCH_COLLECTION_FEED_PROFILES.mobile.cardsPerParent) ||
    (first === WATCH_COLLECTION_FEED_PROFILES.desktop.first &&
      cardsPerParent === WATCH_COLLECTION_FEED_PROFILES.desktop.cardsPerParent)
  )
}

export function normalizeDynamicCollectionFeedInput(
  input: DynamicCollectionFeedInputCandidate,
): NormalizedDynamicCollectionFeedInput {
  const locale = input.locale.trim()
  const languageSlug = input.languageSlug.trim().toLowerCase()
  const cacheScope = input.cacheScope ?? "live"
  const cacheSignature = input.cacheSignature?.trim() || null
  const after = input.after?.trim() || null

  if (
    !hasUiLocale(locale) ||
    !LANGUAGE_SLUG_PATTERN.test(languageSlug) ||
    !PUBLIC_WATCH_LANGUAGE_SLUGS.has(languageSlug) ||
    (cacheScope !== "live" && cacheScope !== "preview") ||
    (cacheSignature !== null &&
      !WATCH_COLLECTION_FEED_CACHE_SIGNATURE_PATTERN.test(cacheSignature)) ||
    (after !== null && !CURSOR_PATTERN.test(after)) ||
    !Number.isInteger(input.first) ||
    !Number.isInteger(input.cardsPerParent) ||
    !isAllowedProfile(input.first, input.cardsPerParent)
  ) {
    throw new DynamicCollectionFeedValidationError(
      "request",
      "Invalid collection feed request",
    )
  }

  return {
    locale,
    languageSlug,
    cacheScope,
    cacheSignature,
    after,
    excludedIds: normalizeReferences(input.excludedIds),
    excludedSlugs: normalizeReferences(input.excludedSlugs),
    first: input.first as 2 | 3,
    cardsPerParent: input.cardsPerParent as 8 | 12,
  }
}

export function mergeDynamicCollectionFeedExcludedIds(
  blockIds: readonly string[] | null | undefined,
  featuredIds: readonly string[],
): string[] {
  return boundDynamicCollectionFeedReferences([
    ...(blockIds ?? []),
    ...featuredIds,
  ])
}

export function boundDynamicCollectionFeedReferences(
  references: readonly string[],
): string[] {
  return [...new Set(references)].slice(0, WATCH_COLLECTION_FEED_MAX_EXCLUSIONS)
}

export function dynamicCollectionFeedSearchParams(
  input: NormalizedDynamicCollectionFeedInput,
): URLSearchParams {
  const params = new URLSearchParams({
    locale: input.locale,
    languageSlug: input.languageSlug,
    first: String(input.first),
    cardsPerParent: String(input.cardsPerParent),
  })
  if (input.cacheScope === "preview") params.set("scope", "preview")
  if (input.after) params.set("after", input.after)
  for (const id of input.excludedIds) params.append("excludedIds", id)
  for (const slug of input.excludedSlugs) params.append("excludedSlugs", slug)
  if (input.cacheSignature) {
    params.set("cacheSignature", input.cacheSignature)
  }
  return params
}

function isDynamicCollectionFeedItem(
  value: unknown,
): value is DynamicCollectionFeedItem {
  if (!isRecord(value)) return false
  if (
    !hasOnlyKeys(value, [
      "id",
      "coreId",
      "title",
      "videoSlug",
      "languageSlug",
      "label",
      "imageUrl",
      "blurDataUrl",
      "dominantColor",
      "muxPlaybackId",
    ])
  ) {
    return false
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.coreId) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.videoSlug) &&
    (value.languageSlug === null ||
      (isNonEmptyString(value.languageSlug) &&
        LANGUAGE_SLUG_PATTERN.test(value.languageSlug))) &&
    isNullableString(value.label) &&
    isNullableString(value.imageUrl) &&
    isNullableString(value.blurDataUrl) &&
    isNullableString(value.dominantColor) &&
    isNullableString(value.muxPlaybackId)
  )
}

function isDynamicCollectionFeedSection(
  value: unknown,
): value is DynamicCollectionFeedSection {
  if (!isRecord(value)) return false
  if (!hasOnlyKeys(value, ["id", "slug", "title", "description", "items"])) {
    return false
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.slug) &&
    isNonEmptyString(value.title) &&
    isNullableString(value.description) &&
    Array.isArray(value.items) &&
    value.items.every(isDynamicCollectionFeedItem)
  )
}

export function parseDynamicCollectionFeedPage(
  value: unknown,
  limits: {
    first: number
    cardsPerParent: number
  } = WATCH_COLLECTION_FEED_PROFILES.desktop,
): DynamicCollectionFeedPage {
  if (!isRecord(value)) {
    throw new DynamicCollectionFeedValidationError(
      "response",
      "Invalid collection feed response",
    )
  }
  if (
    !hasOnlyKeys(value, ["sections", "endCursor", "hasNextPage"]) ||
    !Array.isArray(value.sections) ||
    !value.sections.every(isDynamicCollectionFeedSection) ||
    value.sections.length > limits.first ||
    value.sections.some(
      (section) => section.items.length > limits.cardsPerParent,
    ) ||
    !isNullableString(value.endCursor) ||
    typeof value.hasNextPage !== "boolean" ||
    (value.hasNextPage && value.endCursor === null)
  ) {
    throw new DynamicCollectionFeedValidationError(
      "response",
      "Invalid collection feed response",
    )
  }

  return {
    sections: value.sections,
    endCursor: value.endCursor,
    hasNextPage: value.hasNextPage,
  }
}
