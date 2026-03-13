import { draftMode } from "next/headers"
import { NextResponse } from "next/server"
import { env } from "@/env"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get("secret")
  const redirectParam =
    url.searchParams.get("url") ?? url.searchParams.get("redirect") ?? "/"
  const redirect =
    redirectParam.startsWith("/") && !redirectParam.startsWith("//")
      ? redirectParam
      : "/"
  const status = url.searchParams.get("status")

  if (secret !== env.STRAPI_PREVIEW_SECRET) {
    return NextResponse.json(
      { error: "invalid_preview_secret" },
      { status: 401 },
    )
  }

  const draft = await draftMode()
  if (status === "published") {
    draft.disable()
  } else {
    draft.enable()
  }
  return NextResponse.redirect(new URL(redirect, url.origin))
}
