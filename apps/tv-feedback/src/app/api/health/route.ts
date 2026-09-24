import { NextResponse } from "next/server"

import { config } from "@/server/config"
import { redis } from "@/server/redis"
import { grantMode } from "@/server/tvGrant"

export const runtime = "nodejs"

export async function GET() {
  try {
    const env = config()
    if (
      !env.FEEDBACK_SESSION_SECRET ||
      !env.REDIS_URL ||
      !env.FEEDBACK_BASE_URL ||
      !env.FEEDBACK_LINEAR_API_KEY ||
      !env.FEEDBACK_LINEAR_TEAM_ID ||
      !env.FEEDBACK_LINEAR_PROJECT_ID ||
      !env.FEEDBACK_LINEAR_LABEL_ID ||
      (process.env.NODE_ENV === "production" && !env.TURNSTILE_SECRET_KEY) ||
      (grantMode() === "enforce" &&
        (!env.FEEDBACK_PLAY_PACKAGE ||
          !env.FEEDBACK_PLAY_CERT_SHA256 ||
          !env.FEEDBACK_PLAY_ALLOWED_VERSIONS ||
          !env.FEEDBACK_GOOGLE_SERVICE_ACCOUNT_JSON ||
          !env.FEEDBACK_APPLE_TEAM_ID ||
          !env.FEEDBACK_APPLE_KEY_ID ||
          !env.FEEDBACK_APPLE_PRIVATE_KEY ||
          !env.FEEDBACK_APPLE_BUNDLE_ID ||
          !env.FEEDBACK_APPLE_ALLOWED_BUILDS ||
          env.FEEDBACK_APPLE_DEVICECHECK_ENABLED !== "true"))
    )
      throw new Error("not_ready")
    if ((await redis().ping()) !== "PONG") throw new Error("redis_unavailable")
    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
}
