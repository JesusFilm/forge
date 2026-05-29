import { timingSafeEqual } from "node:crypto"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { env } from "@/env"
import { AVAILABLE_UI_LOCALES } from "@/i18n/locales"
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale"
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

  const push = (path: string) => {
    revalidatePath(path)
    revalidated.push(path)
  }

  // Emit BOTH the canonical `.html` shape (post-Phase-2 rendered route) AND
  // the legacy bare shape. The bare shape is kept for a 30-day overlap so an
  // inflight webhook from an older admin deploy — or a still-cached bare route
  // — still gets busted. `.html` is appended per segment via appendHtmlSuffix
  // (idempotent). Over-revalidating a non-existent variant is harmless.
  const pushOneSeg = (seg: string) => {
    push(`/${appendHtmlSuffix(seg)}`) // canonical `/{seg}.html`
    push(`/${seg}`) // legacy bare (overlap)
  }
  const pushTwoSeg = (a: string, b: string) => {
    push(`/${appendHtmlSuffix(a)}/${appendHtmlSuffix(b)}`) // `/{a}.html/{b}.html`
    push(`/${a}/${b}`) // legacy bare (overlap)
  }

  const revalidateAllWatchPages = () => {
    revalidatePath("/", "layout")
    revalidated.push("/ (layout)")
  }

  const revalidateHomepagePaths = () => {
    push("/")
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
