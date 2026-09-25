import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { requireConfig } from "@/server/config"
import {
  appleGrantRequestSchema,
  verifyAppleDeviceCheck,
} from "@/server/appleGrant"
import { attemptChallenge, issueGrant } from "@/server/feedbackState"
import { rateLimit } from "@/server/redis"
import {
  canonicalGrantRequest,
  hashSecret,
  nextUtcMidnight,
  publicKeyMatches,
  randomGrantSecret,
  randomReference,
} from "@/server/tvGrant"

import { readJsonLimited } from "@/server/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const parsed = appleGrantRequestSchema.safeParse(
    await readJsonLimited(request).catch(() => null),
  )
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  const input = parsed.data
  try {
    if (!(await rateLimit("apple-verification-global", "all", 200, 3600)))
      return NextResponse.json({ error: "rate_limited" }, { status: 429 })
    const challenge = await attemptChallenge(input.challengeId)
    if (!challenge)
      return NextResponse.json({ error: "challenge_expired" }, { status: 403 })
    const canonical = canonicalGrantRequest(
      input,
      challenge.nonce,
      challenge.day,
    )
    if (
      !publicKeyMatches(input, canonical) ||
      !(await verifyAppleDeviceCheck(input))
    )
      return NextResponse.json(
        { error: "verification_failed" },
        { status: 403 },
      )
    const secret = randomGrantSecret()
    const reference = randomReference()
    const expires = nextUtcMidnight(challenge.day)
    const outcome = await issueGrant(
      input.challengeId,
      input.installationId,
      input.keyFingerprint,
      challenge.day,
      {
        id: randomUUID(),
        installationId: input.installationId,
        day: challenge.day,
        reference,
        expiresAt: expires.getTime(),
      },
      hashSecret(secret),
    )
    if (outcome !== "ok")
      return NextResponse.json({ error: outcome }, { status: 403 })
    const feedbackUrl = new URL(
      "/tv",
      requireConfig("FEEDBACK_BASE_URL").FEEDBACK_BASE_URL,
    )
    feedbackUrl.hash = `grant=${secret}`
    return NextResponse.json(
      {
        feedbackUrl: feedbackUrl.toString(),
        referenceCode: reference,
        expiresAt: expires.toISOString(),
        serverTime: new Date().toISOString(),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 })
  }
}
