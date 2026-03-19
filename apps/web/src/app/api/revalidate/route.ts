import { timingSafeEqual } from "node:crypto"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { env } from "@/env"
import { isLocale, SUPPORTED_LOCALES } from "@/lib/locale"

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i

interface StrapiWebhookPayload {
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

export async function POST(request: Request) {
  const secret = request.headers.get("x-revalidation-secret")
  if (!isValidSecret(secret, env.REVALIDATION_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: StrapiWebhookPayload
  try {
    body = (await request.json()) as StrapiWebhookPayload
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const { model, entry } = body

  if (model !== "experience" || !entry) {
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

  if (slug && locale) {
    revalidatePath(`/${slug}/${locale}`)
    revalidated.push(`/${slug}/${locale}`)
  } else if (slug) {
    for (const loc of SUPPORTED_LOCALES) {
      revalidatePath(`/${slug}/${loc}`)
      revalidated.push(`/${slug}/${loc}`)
    }
    revalidatePath(`/${slug}`)
    revalidated.push(`/${slug}`)
  }

  // Always revalidate homepage in case the updated experience is the homepage
  revalidatePath("/")
  revalidated.push("/")

  return NextResponse.json({ revalidated: true })
}
