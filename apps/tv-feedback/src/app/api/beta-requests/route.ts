import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"

import { appendBetaRequest } from "@/server/betaRequests"
import { key, rateLimit, redis } from "@/server/redis"
import { readJsonLimited } from "@/server/request"
import { verifyTurnstile } from "@/server/turnstile"

export const runtime = "nodejs"

const schema = z
  .object({
    email: z.string().trim().email().max(254),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict()

export async function POST(request: Request) {
  const input = schema.safeParse(
    await readJsonLimited(request).catch(() => null),
  )
  if (!input.success)
    return NextResponse.json(
      { error: "Enter a valid email and complete verification." },
      { status: 400 },
    )
  try {
    if (
      !process.env.BETA_REQUESTS_SPREADSHEET_ID ||
      !(
        process.env.BETA_REQUESTS_GOOGLE_SERVICE_ACCOUNT_JSON ??
        process.env.FEEDBACK_GOOGLE_SERVICE_ACCOUNT_JSON
      )
    )
      return NextResponse.json(
        { error: "Requests are temporarily unavailable. Please try later." },
        { status: 503 },
      )
    if (!(await rateLimit("beta-signup", "global", 60, 60)))
      return NextResponse.json(
        { error: "Please wait a moment and try again." },
        { status: 429 },
      )
    if (
      !(await verifyTurnstile(
        input.data.turnstileToken,
        "tv_beta_signup",
        true,
      ))
    )
      return NextResponse.json(
        { error: "Please verify again." },
        { status: 403 },
      )
    const email = input.data.email.toLowerCase()
    const identity = createHash("sha256").update(email).digest("hex")
    const lock = key("beta-request", identity)
    if (!(await redis().set(lock, "pending", "EX", 3600, "NX")))
      return NextResponse.json(
        {
          error:
            "A request for this email was already received recently. Please wait before trying again.",
        },
        { status: 409 },
      )
    await appendBetaRequest(email)
    await redis().set(lock, "saved", "EX", 86400)
    return NextResponse.json(
      { saved: true },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json(
      { error: "We could not confirm your request. Please try again later." },
      { status: 503 },
    )
  }
}
