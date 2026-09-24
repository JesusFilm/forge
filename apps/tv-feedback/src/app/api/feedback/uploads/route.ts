import { NextResponse } from "next/server"

import {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  uploadReservationSchema,
} from "@/lib/contracts"
import { reserveUpload } from "@/server/feedbackState"
import { rateLimit } from "@/server/redis"
import { currentSession, isSameOrigin } from "@/server/session"

import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!(await isSameOrigin(request)))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 })
  const sessionId = await currentSession()
  if (!sessionId)
    return NextResponse.json({ error: "session_required" }, { status: 401 })
  const parsed = uploadReservationSchema.safeParse(
    await readJsonLimited(request).catch(() => null),
  )
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_file" }, { status: 400 })
  const input = parsed.data
  const kind = input.type.startsWith("image/") ? "image" : "video"
  if (input.size > (kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES))
    return NextResponse.json({ error: "file_too_large" }, { status: 413 })
  try {
    if (
      !(await rateLimit(
        "service-upload",
        new Date().toISOString().slice(0, 10),
        500,
        86400,
      ))
    )
      return NextResponse.json({ error: "quota_exceeded" }, { status: 429 })
    const result = await reserveUpload(sessionId, {
      filename: input.name.replace(/[\\/]/g, "_"),
      type: input.type,
      size: input.size,
      kind,
    })
    if ("error" in result)
      return NextResponse.json({ error: result.error }, { status: 429 })
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    })
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 })
  }
}
