import { revalidateTag } from "next/cache"
import { NextResponse } from "next/server"

interface StrapiWebhookPayload {
  event: string
  model: string
  entry?: {
    slug?: string
    locale?: string
    documentId?: string
  }
}

export async function POST(request: Request) {
  const token = request.headers.get("x-forge-revalidate-token")
  if (
    !process.env.STRAPI_REVALIDATE_TOKEN ||
    token !== process.env.STRAPI_REVALIDATE_TOKEN
  ) {
    return NextResponse.json(
      { error: "invalid_revalidate_token" },
      { status: 401 },
    )
  }

  const body = (await request.json().catch(() => ({}))) as StrapiWebhookPayload
  const slug = body.entry?.slug
  const tag = slug ? `experience:${slug}` : "experience"

  revalidateTag(tag, "max")

  return NextResponse.json({ revalidated: true, tag })
}
