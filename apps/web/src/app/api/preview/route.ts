import { draftMode } from "next/headers"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get("token")
  const redirect = url.searchParams.get("redirect") ?? "/"

  if (
    !process.env.STRAPI_PREVIEW_TOKEN ||
    token !== process.env.STRAPI_PREVIEW_TOKEN
  ) {
    return NextResponse.json(
      { error: "invalid_preview_token" },
      { status: 401 },
    )
  }

  const draft = await draftMode()
  draft.enable()
  return NextResponse.redirect(new URL(redirect, url.origin))
}
