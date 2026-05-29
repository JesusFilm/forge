import { timingSafeEqual } from "node:crypto"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { env } from "@/env"
import { AVAILABLE_UI_LOCALES } from "@/i18n/locales"
import {
  DEFAULT_LOCALE,
  isLocale,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"
import { appendHtmlSuffix } from "@/lib/url-shape"

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i
const BEARER_PREFIX = "Bearer "

interface RevalidateWebhookPayload {
  model?: string
  entry?: {
    slug?: string
    locale?: string
  }
}

function isValidSecret(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
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

  let body: RevalidateWebhookPayload
  try {
    body = (await request.json()) as RevalidateWebhookPayload
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const { model, entry } = body

  if (
    !entry ||
    !["experience", "video", "watch-setting"].includes(model ?? "")
  ) {
    return NextResponse.json(
      { revalidated: false, reason: "unhandled model or missing entry" },
      { status: 200 },
    )
  }

  const { slug, locale } = entry

  if (slug && !SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 })
  }
  if (locale && !isLocale(locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 })
  }

  const revalidated: string[] = []
  const seen = new Set<string>()

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

  const pushInternal = (publicPath: string, rawLocale?: string) => {
    const identity = resolveWatchLocaleIdentity(rawLocale)
    const suffix = publicPath === "/" ? "" : publicPath
    push(`/${identity.locale}/${identity.htmlLang}${suffix}`)
  }

  // Emit BOTH the canonical public `.html` shape and the internal rewritten
  // route path. The public entries are kept for the overlap with older deploys
  // and cached aliases; the internal entries are what Next's App Router now
  // renders under /[locale]/[htmlLang]. Over-revalidating a non-existent
  // variant is harmless.
  const pushOneSeg = (seg: string) => {
    const canonical = `/${appendHtmlSuffix(seg)}`
    push(canonical) // canonical public `/{seg}.html`
    pushInternal(canonical, isLocale(seg) ? seg : undefined)
    push(`/${seg}`) // legacy bare (overlap)
  }
  const pushTwoSeg = (a: string, b: string) => {
    const canonical = `/${appendHtmlSuffix(a)}/${appendHtmlSuffix(b)}`
    push(canonical) // public `/{a}.html/{b}.html`
    pushInternal(canonical, b)
    push(`/${a}/${b}`) // legacy bare (overlap)
  }

  const revalidateAllWatchPages = () => {
    pushLayout("/[locale]/[htmlLang]")
    pushLayout("/")
  }

  const revalidateHomepagePaths = () => {
    push("/")
    pushInternal("/")
    for (const loc of AVAILABLE_UI_LOCALES) {
      pushOneSeg(loc)
    }
  }

  const revalidateSlugPaths = () => {
    if (slug && locale) {
      pushTwoSeg(slug, locale)
      if (locale === DEFAULT_LOCALE) {
        pushOneSeg(slug)
      }
      return
    }

    if (!slug) return

    pushOneSeg(slug)
    for (const loc of AVAILABLE_UI_LOCALES) {
      pushTwoSeg(slug, loc)
    }
  }

  if (model === "watch-setting") {
    revalidateAllWatchPages()
    revalidateHomepagePaths()
    return NextResponse.json({ revalidated: true, paths: revalidated })
  }

  revalidateSlugPaths()

  if (model === "experience") {
    revalidateAllWatchPages()
    revalidateHomepagePaths()
  }

  return NextResponse.json({ revalidated: true, paths: revalidated })
}
