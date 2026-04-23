import { NextResponse } from "next/server"
import { authenticateRequest } from "@/lib/auth"
import { languageCache } from "@/app/api/languages/cache"

export async function GET(request: Request) {
  const authError = await authenticateRequest(request)
  if (authError) return authError

  try {
    const payload = await languageCache.get()
    return new Response(payload, {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error(
      "[api/languages] Failed to fetch language data:",
      error instanceof Error ? error.message : "Unknown error",
    )
    return NextResponse.json(
      { error: "Failed to fetch language data" },
      { status: 502 },
    )
  }
}
