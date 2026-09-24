import { NextResponse } from "next/server"

import { createSession, currentSession, isSameOrigin } from "@/server/session"
import { verifyTurnstile } from "@/server/turnstile"
import { activeGrant, grantMode } from "@/server/tvGrant"

import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!(await isSameOrigin(request)))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 })
  const existing = await currentSession()
  if (grantMode() === "enforce") {
    if (!existing || !(await activeGrant(existing)))
      return NextResponse.json({ error: "grant_required" }, { status: 403 })
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    )
  }
  if (existing)
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    )
  const input: unknown = await readJsonLimited(request).catch(() => null)
  const token =
    input &&
    typeof input === "object" &&
    "turnstileToken" in input &&
    typeof input.turnstileToken === "string"
      ? input.turnstileToken
      : ""
  if (!(await verifyTurnstile(token)))
    return NextResponse.json(
      { error: "verification_required" },
      { status: 403 },
    )
  try {
    await createSession()
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "rate_limited"
            ? "rate_limited"
            : "unavailable",
      },
      { status: 503 },
    )
  }
}
