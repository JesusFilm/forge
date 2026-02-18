import { draftMode } from "next/headers"
import { NextResponse } from "next/server"
import { env } from "@/env"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token")
  const redirect = url.searchParams.get("redirect") ?? "/"

  if (!env.STRAPI_PREVIEW_TOKEN || token !== env.STRAPI_PREVIEW_TOKEN) {
    return NextResponse.json(
      { error: "invalid_preview_token" },
      { status: 401 },
    )
  }

  const draft = await draftMode()
  draft.enable()
  return NextResponse.redirect(new URL(redirect, url.origin))
}
