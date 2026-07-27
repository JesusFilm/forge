import { timingSafeEqual } from "node:crypto"
import {
  buildExplicitWatchVideoPath,
  isLanguageLessWatchVideoPathEligible,
} from "@forge/watch-url-policy/routes"
import { revalidatePath, revalidateTag } from "next/cache"
import { NextResponse } from "next/server"
import { env } from "@/env"
import { AVAILABLE_UI_LOCALES } from "@/i18n/generated-ui-locales"
import {
  DEFAULT_LOCALE,
  isLocale,
  publicWatchAudioLanguageSlugForLocale,
  publicWatchHomeLanguageSlugForLocale,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
import { appendHtmlSuffix } from "@/lib/url-shape"
import {
  WATCH_CACHE_TAG_GROUPS,
  type WatchCacheTag,
} from "@/lib/watch-cache-tags"
import { clearWatchRouteManifestCache } from "@/lib/watch-route-manifest"
import { clearWatchSeoManifestCache } from "@/lib/watch-seo-manifest"

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i
const BEARER_PREFIX = "Bearer "
const REVALIDATE_TAG_PROFILE = { expire: 0 } as const

interface RevalidateWebhookPayload {
  model: RevalidateModel
  entry: {
    slug?: string
    locale?: string
  }
}

type RevalidateModel =
  | "experience"
  | "video"
  | "watch-route-manifest"
  | "watch-seo-manifest"
  | "watch-setting"

const REVALIDATE_MODELS = new Set<RevalidateModel>([
  "experience",
  "video",
  "watch-route-manifest",
  "watch-seo-manifest",
  "watch-setting",
])
const REVALIDATE_MODEL_VALUES: ReadonlySet<string> = REVALIDATE_MODELS

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRevalidateModel(value: unknown): value is RevalidateModel {
  return typeof value === "string" && REVALIDATE_MODEL_VALUES.has(value)
}

function parsePayload(
  value: unknown,
):
  | { ok: true; payload: RevalidateWebhookPayload }
  | { ok: false; reason: "unhandled" | "invalid_payload" } {
  if (!isRecord(value)) return { ok: false, reason: "invalid_payload" }
  if (!isRevalidateModel(value.model) || value.entry === undefined) {
    return { ok: false, reason: "unhandled" }
  }
  if (!isRecord(value.entry)) {
    return { ok: false, reason: "invalid_payload" }
  }

  const { slug, locale } = value.entry
  if (slug != null && typeof slug !== "string") {
    return { ok: false, reason: "invalid_payload" }
  }
  if (locale != null && typeof locale !== "string") {
    return { ok: false, reason: "invalid_payload" }
  }

  return {
    ok: true,
    payload: {
      model: value.model,
      entry: {
        ...(slug !== undefined && slug !== null ? { slug } : {}),
        ...(locale !== undefined && locale !== null ? { locale } : {}),
      },
    },
  }
}

function isValidSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(providedBuffer, expectedBuffer)
}

function extractToken(request: Request): string | null {
  // Admin emits `Authorization: Bearer <token>`. The legacy
  // `x-revalidation-secret` header is retained as a fallback so an
  // accidentally-still-running Strapi emitter cannot 401-loop —
  // both header forms validate against the same `REVALIDATION_SECRET`.
  const auth = request.headers.get("authorization")
  if (auth && auth.startsWith(BEARER_PREFIX)) {
    return auth.slice(BEARER_PREFIX.length)
  }
  return request.headers.get("x-revalidation-secret")
}

export async function POST(request: Request) {
  const token = extractToken(request)
  if (!isValidSecret(token, env.REVALIDATION_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let parsedJson: unknown
  try {
    parsedJson = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const parsedPayload = parsePayload(parsedJson)
  if (!parsedPayload.ok && parsedPayload.reason === "invalid_payload") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }
  if (!parsedPayload.ok) {
    return NextResponse.json(
      { revalidated: false, reason: "unhandled model or missing entry" },
      { status: 200 },
    )
  }

  const { model, entry } = parsedPayload.payload
  const { slug, locale } = entry

  if (slug !== undefined && !SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 })
  }
  if (locale !== undefined && !isLocale(locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 })
  }

  const revalidated: string[] = []
  const seen = new Set<string>()
  const revalidatedTags: WatchCacheTag[] = []
  const seenTags = new Set<WatchCacheTag>()
  const tagErrors: string[] = []

  const push = (path: string) => {
    if (seen.has(path)) return
    seen.add(path)
    revalidatePath(path)
    revalidated.push(path)
  }

  const pushLayout = (path: string) => {
    const key = `${path} (layout)`
    if (seen.has(key)) return
    seen.add(key)
    revalidatePath(path, "layout")
    revalidated.push(key)
  }

  const pushPagePattern = (path: string) => {
    const key = `${path} (page)`
    if (seen.has(key)) return
    seen.add(key)
    revalidatePath(path, "page")
    revalidated.push(key)
  }

  const pushInternal = (publicPath: string, rawLocale?: string) => {
    const identity = resolveWatchLocaleIdentity(rawLocale)
    const suffix = publicPath === "/" ? "" : publicPath
    push(`/${identity.locale}/${identity.htmlLang}${suffix}`)
  }

  const pushTag = (tag: WatchCacheTag) => {
    if (seenTags.has(tag)) return
    seenTags.add(tag)
    try {
      revalidateTag(tag, REVALIDATE_TAG_PROFILE)
      revalidatedTags.push(tag)
    } catch (error) {
      tagErrors.push(tag)
      const detail =
        error instanceof Error
          ? error.message.slice(0, 500)
          : String(error).slice(0, 500)
      console.warn(
        `[revalidate] event=watch_revalidate.tag.failed tag=${tag} detail=${detail}`,
      )
    }
  }

  const pushTags = (tags: readonly WatchCacheTag[]) => {
    for (const tag of tags) {
      pushTag(tag)
    }
  }

  // Emit BOTH the canonical public `.html` shape and the internal rewritten
  // route path. The public entries are kept for the overlap with older deploys
  // and cached aliases; the internal entries are what Next's App Router now
  // renders under /[locale]/[htmlLang]. Over-revalidating a non-existent
  // variant is harmless.
  const pushOneSeg = (seg: string, rawLocale?: string) => {
    const canonical = `/${appendHtmlSuffix(seg)}`
    push(canonical) // canonical public `/{seg}.html`
    pushInternal(canonical, rawLocale)
    push(`/${seg}`) // legacy bare (overlap)
  }
  const pushTwoSeg = (a: string, b: string) => {
    const canonical = buildExplicitWatchVideoPath(a, b)
    push(canonical) // public `/{a}.html/{b}.html`
    pushInternal(canonical, b)
    push(`/${a}/${b}`) // legacy bare (overlap)
  }

  const revalidateAllWatchPages = () => {
    pushLayout("/[locale]/[htmlLang]")
    pushLayout("/")
  }

  const revalidateWatchSitemaps = () => {
    push("/sitemap.xml")
    pushPagePattern("/sitemap/[id]")
    pushLayout("/sitemap")
  }

  const revalidateHomepagePaths = () => {
    push("/")
    pushInternal("/")
    for (const loc of AVAILABLE_UI_LOCALES) {
      const homeLanguageSlug = publicWatchHomeLanguageSlugForLocale(loc)
      if (!homeLanguageSlug) continue
      pushOneSeg(homeLanguageSlug, homeLanguageSlug)
    }
  }

  const revalidateSlugPaths = () => {
    if (slug && locale) {
      const audioLanguageSlug = publicWatchAudioLanguageSlugForLocale(locale)
      if (!audioLanguageSlug) return
      pushTwoSeg(slug, audioLanguageSlug)
      if (
        locale === DEFAULT_LOCALE &&
        isLanguageLessWatchVideoPathEligible(slug)
      ) {
        pushOneSeg(slug)
      }
      return
    }

    if (!slug) return

    if (model === "experience" || isLanguageLessWatchVideoPathEligible(slug)) {
      pushOneSeg(slug)
    }
    for (const loc of AVAILABLE_UI_LOCALES) {
      const audioLanguageSlug = publicWatchAudioLanguageSlugForLocale(loc)
      if (!audioLanguageSlug) continue
      pushTwoSeg(slug, audioLanguageSlug)
    }
  }

  const responsePayload = (extra: Record<string, unknown> = {}) => ({
    revalidated: true,
    paths: revalidated,
    tags: revalidatedTags,
    ...(tagErrors.length ? { tagErrors } : {}),
    ...extra,
  })

  if (model === "watch-route-manifest") {
    pushTags(WATCH_CACHE_TAG_GROUPS.watchRouteManifest)
    clearWatchRouteManifestCache()
    revalidateAllWatchPages()
    return NextResponse.json(
      responsePayload({
        manifestCacheCleared: true,
      }),
    )
  }

  if (model === "watch-seo-manifest") {
    pushTags(WATCH_CACHE_TAG_GROUPS.watchSeoManifest)
    clearWatchSeoManifestCache()
    revalidateWatchSitemaps()
    return NextResponse.json(
      responsePayload({
        seoManifestCacheCleared: true,
      }),
    )
  }

  if (model === "watch-setting") {
    pushTags(WATCH_CACHE_TAG_GROUPS.watchSetting)
    revalidateAllWatchPages()
    revalidateHomepagePaths()
    return NextResponse.json(responsePayload())
  }

  if (model === "experience") {
    pushTags(WATCH_CACHE_TAG_GROUPS.experience)
  }

  if (model === "video") {
    pushTags(WATCH_CACHE_TAG_GROUPS.video)
    if (!slug) {
      revalidateAllWatchPages()
    }
  }

  revalidateSlugPaths()

  if (model === "experience") {
    revalidateAllWatchPages()
    revalidateHomepagePaths()
  }

  return NextResponse.json(responsePayload())
}
