import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { env } from "@/env"
import { SUPPORTED_LOCALES } from "@/lib/locale"

interface StrapiWebhookPayload {
  model?: string
  entry?: {
    slug?: string
    locale?: string
  }
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-revalidation-secret")
  if (secret !== env.REVALIDATION_SECRET) {
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
  } else {
    revalidatePath("/")
    revalidated.push("/")
  }

  return NextResponse.json({ revalidated: true, paths: revalidated })
}
