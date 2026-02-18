import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { env } from "@/env"

export async function POST(request: Request) {
  const token = request.headers.get("x-forge-revalidate-token")
  if (!env.STRAPI_REVALIDATE_TOKEN || token !== env.STRAPI_REVALIDATE_TOKEN) {
    return NextResponse.json(
      { error: "invalid_revalidate_token" },
      { status: 401 },
    )
  }

  const body = (await request.json().catch(() => ({}))) as { path?: string }
  const path = body.path ?? "/"
  revalidatePath(path)
  return NextResponse.json({ revalidated: true, path })
}
