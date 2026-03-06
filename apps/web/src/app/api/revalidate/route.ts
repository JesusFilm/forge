import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const token = request.headers.get("x-forge-revalidate-token")
  const revalidateToken = process.env.STRAPI_REVALIDATE_TOKEN

  if (!revalidateToken || token !== revalidateToken) {
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
