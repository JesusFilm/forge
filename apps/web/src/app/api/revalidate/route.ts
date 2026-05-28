import { timingSafeEqual } from "node:crypto"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { env } from "@/env"
import { AVAILABLE_UI_LOCALES } from "@/i18n/locales"
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale"

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

  const revalidateAllWatchPages = () => {
    revalidatePath("/", "layout")
    revalidated.push("/ (layout)")
  }

  const revalidateHomepagePaths = () => {
    revalidatePath("/")
    revalidated.push("/")

    for (const loc of AVAILABLE_UI_LOCALES) {
      revalidatePath(`/${loc}`)
      revalidated.push(`/${loc}`)
    }
  }

  const revalidateSlugPaths = () => {
    if (slug && locale) {
      revalidatePath(`/${slug}/${locale}`)
      revalidated.push(`/${slug}/${locale}`)

      if (locale === DEFAULT_LOCALE) {
        revalidatePath(`/${slug}`)
        revalidated.push(`/${slug}`)
      }
      return
    }

    if (!slug) return

    revalidatePath(`/${slug}`)
    revalidated.push(`/${slug}`)

    for (const loc of AVAILABLE_UI_LOCALES) {
      revalidatePath(`/${slug}/${loc}`)
      revalidated.push(`/${slug}/${loc}`)
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
