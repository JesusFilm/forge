import { NextResponse } from "next/server"

import {
  uploadForId,
  transitionUpload,
  activeGrantForSession,
} from "@/server/feedbackState"
import { uploadMedia } from "@/server/linear"
import { normalizeMedia, readBounded } from "@/server/media"
import { key, redis } from "@/server/redis"
import { currentSession, isSameOrigin } from "@/server/session"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const sessionId = await currentSession()
  if (!sessionId)
    return NextResponse.json({ error: "session_required" }, { status: 401 })
  const { id } = await context.params
  const upload = /^[0-9a-f-]{36}$/.test(id) ? await uploadForId(id) : null
  if (!upload || upload.sessionId !== sessionId)
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json(
    { status: upload.status, error_code: upload.error ?? null },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function PUT(request: Request, context: Context) {
  if (!(await isSameOrigin(request)))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 })
  const sessionId = await currentSession()
  if (!sessionId || !(await activeGrantForSession(sessionId)))
    return NextResponse.json({ error: "grant_required" }, { status: 403 })
  const { id } = await context.params
  const upload = /^[0-9a-f-]{36}$/.test(id) ? await uploadForId(id) : null
  if (!upload || upload.sessionId !== sessionId)
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (
    request.headers.get("content-type") !== upload.type ||
    Number(request.headers.get("content-length")) !== upload.size ||
    !request.body
  )
    return NextResponse.json({ error: "invalid_upload" }, { status: 400 })
  const claimed = await transitionUpload(id, sessionId, "reserved", "uploading")
  if (!claimed)
    return NextResponse.json({ error: "not_reserved" }, { status: 409 })
  const concurrent = await redis().eval(
    `local count = redis.call('INCR', KEYS[1])
     redis.call('EXPIRE', KEYS[1], 300)
     if count > 2 then redis.call('DECR', KEYS[1]); return 0 end
     return 1`,
    1,
    key("active-uploads", "all"),
  )
  if (concurrent !== 1) {
    await transitionUpload(id, sessionId, "uploading", "rejected", {
      error: "busy",
    })
    return NextResponse.json({ error: "busy" }, { status: 429 })
  }
  try {
    const bytes = await readBounded(request, upload.size)
    const final = await normalizeMedia(upload, bytes)
    if (!(await activeGrantForSession(sessionId)))
      throw new Error("grant_expired")
    const assetUrl = await uploadMedia(final.bytes, final.filename, final.type)
    const ready = await transitionUpload(id, sessionId, "uploading", "ready", {
      assetUrl,
      finalType: final.type,
      finalSize: final.bytes.length,
    })
    if (!ready) throw new Error("upload_state_changed")
    return NextResponse.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    await transitionUpload(id, sessionId, "uploading", "rejected", {
      error: "upload_failed",
    }).catch(() => undefined)
    return NextResponse.json({ error: "upload_failed" }, { status: 422 })
  } finally {
    await redis()
      .eval(
        `local count = tonumber(redis.call('GET', KEYS[1]) or '0')
         if count > 0 then redis.call('DECR', KEYS[1]) end
         return 1`,
        1,
        key("active-uploads", "all"),
      )
      .catch(() => undefined)
  }
}

export async function DELETE(request: Request, context: Context) {
  if (!(await isSameOrigin(request)))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 })
  const sessionId = await currentSession()
  if (!sessionId)
    return NextResponse.json({ error: "session_required" }, { status: 401 })
  const { id } = await context.params
  const upload = /^[0-9a-f-]{36}$/.test(id) ? await uploadForId(id) : null
  if (!upload || upload.sessionId !== sessionId)
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (
    upload.status !== "reserved" &&
    upload.status !== "ready" &&
    upload.status !== "rejected"
  )
    return NextResponse.json({ error: "cannot_remove" }, { status: 409 })
  const removed = await transitionUpload(
    id,
    sessionId,
    upload.status,
    "removed",
  )
  return removed
    ? NextResponse.json(
        { removed: true },
        { headers: { "Cache-Control": "no-store" } },
      )
    : NextResponse.json({ error: "cannot_remove" }, { status: 409 })
}
