import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { requireConfig } from "@/server/config"
import { createChallenge } from "@/server/feedbackState"
import { rateLimit } from "@/server/redis"
import { nextUtcMidnight, utcDay } from "@/server/tvGrant"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const secret = requireConfig(
      "FEEDBACK_SESSION_SECRET",
    ).FEEDBACK_SESSION_SECRET
    const ip = request.headers.get("x-real-ip") ?? "unknown"
    const ipHash = createHmac("sha256", secret).update(ip).digest("hex")
    if (!(await rateLimit("challenge-global", "all", 1000, 3600)))
      return NextResponse.json({ error: "rate_limited" }, { status: 429 })
    if (!(await rateLimit("challenge", ipHash, 20, 3600)))
      return NextResponse.json({ error: "rate_limited" }, { status: 429 })
    const day = utcDay()
    const id = randomUUID()
    const nonce = randomBytes(32).toString("base64url")
    const expires = new Date(
      Math.min(Date.now() + 120_000, nextUtcMidnight(day).getTime()),
    )
    await createChallenge(
      id,
      nonce,
      day,
      Math.max(1, Math.ceil((expires.getTime() - Date.now()) / 1000)),
    )
    return NextResponse.json(
      { challengeId: id, nonce, utcDay: day, expiresAt: expires.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 })
  }
}
