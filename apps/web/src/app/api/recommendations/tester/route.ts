import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { env } from "@/env"
import {
  exchangeRecommendationTesterLink,
  RECOMMENDATION_TESTER_COOKIE,
  RECOMMENDATION_TESTER_COOKIE_PATH,
} from "@/lib/recommendation-tester-token"
import { readStrictRecommendationJson } from "@/lib/recommendation-route-policy"
import {
  recommendationError,
  recommendationJson,
  RECOMMENDATION_PRIVATE_HEADERS,
} from "@/lib/recommendation-route-response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HEADERS = {
  ...RECOMMENDATION_PRIVATE_HEADERS,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive",
}
const Input = z.object({ token: z.string().min(1).max(1024) }).strict()

/** An invisible credential exchange, outside all Watch layouts and analytics. */
export function GET() {
  const nonce = randomBytes(18).toString("base64")
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Watch</title></head><body><script nonce="${nonce}">
"use strict";
const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
if (token && token.length <= 1024) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  fetch(location.pathname, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }), signal: controller.signal
  }).catch(() => {}).finally(() => {
    clearTimeout(timeout);
    location.replace("/watch");
  });
} else { location.replace("/watch"); }
</script></body></html>`,
    {
      headers: {
        ...HEADERS,
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      },
    },
  )
}

export async function POST(request: Request) {
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: new URL(env.NEXT_PUBLIC_CANONICAL_ORIGIN).origin,
      maxBytes: 2048,
    })
    const input = Input.safeParse(raw)
    if (!input.success) return recommendationJson({ enabled: false }, 400)
    const session = await exchangeRecommendationTesterLink(input.data.token, {
      secret: env.WATCH_RECOMMENDATION_TESTER_SECRET,
      origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
    })
    if (!session) return recommendationJson({ enabled: false }, 403)
    const response = new NextResponse(null, { status: 204, headers: HEADERS })
    response.cookies.set(RECOMMENDATION_TESTER_COOKIE, session.cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: RECOMMENDATION_TESTER_COOKIE_PATH,
      maxAge: session.maxAge,
    })
    return response
  } catch (error) {
    return recommendationError(error)
  }
}
