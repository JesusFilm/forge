import { NextResponse } from "next/server"
import { z } from "zod"

import { activeGrantForSession, grantForSecret } from "@/server/feedbackState"
import {
  createClaimedSession,
  currentSession,
  isSameOrigin,
} from "@/server/session"
import { hashSecret } from "@/server/tvGrant"
import { verifyTurnstile } from "@/server/turnstile"

import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"

const claimSchema = z
  .object({
    secret: z.string().min(40).max(100),
    turnstileToken: z.string().max(2048),
  })
  .strict()

export async function GET() {
  const sessionId = await currentSession()
  const grant = sessionId ? await activeGrantForSession(sessionId) : null
  if (!grant)
    return NextResponse.json({ error: "grant_required" }, { status: 403 })
  return NextResponse.json(
    {
      referenceCode: grant.reference,
      expiresAt: new Date(grant.sessionExpiresAt ?? 0).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function POST(request: Request) {
  if (!(await isSameOrigin(request)))
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 })
  const input = claimSchema.safeParse(
    await readJsonLimited(request).catch(() => null),
  )
  if (!input.success)
    return NextResponse.json({ error: "invalid_code" }, { status: 400 })
  try {
    const hash = hashSecret(input.data.secret)
    const found = await grantForSecret(hash)
    if (
      !found ||
      found.revoked ||
      found.reportId ||
      found.expiresAt <= Date.now()
    )
      return NextResponse.json(
        { error: "invalid_or_expired_code" },
        { status: 403 },
      )
    const existing = await currentSession()
    if (
      existing &&
      found.sessionId === existing &&
      (found.sessionExpiresAt ?? 0) > Date.now()
    )
      return NextResponse.json(
        {
          referenceCode: found.reference,
          expiresAt: new Date(found.sessionExpiresAt ?? 0).toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      )
    if (found.sessionId)
      return NextResponse.json({ error: "already_claimed" }, { status: 409 })
    if (!(await verifyTurnstile(input.data.turnstileToken)))
      return NextResponse.json(
        { error: "verification_required" },
        { status: 403 },
      )
    const result = await createClaimedSession(hash)
    return NextResponse.json(
      {
        referenceCode: result.reference,
        expiresAt: result.expiresAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const code =
      error instanceof Error &&
      ["already_claimed", "rate_limited", "invalid_or_expired_code"].includes(
        error.message,
      )
        ? error.message
        : "unavailable"
    return NextResponse.json(
      { error: code },
      {
        status:
          code === "unavailable" ? 503 : code === "rate_limited" ? 429 : 409,
      },
    )
  }
}
