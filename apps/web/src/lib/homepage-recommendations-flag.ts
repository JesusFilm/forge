import "server-only"
import { NextRequest } from "next/server"
import { env } from "@/env"
import {
  WEB_AUTH_SESSION_COOKIE,
  readWebAuthSessionCookie,
} from "@/auth/web-session"
import { isWatchHomepageRecommendationsEnabled } from "@/lib/feature-flags"

export async function homepageRecommendationsEnabled(
  request: Request,
): Promise<boolean> {
  if (env.WATCH_FOR_YOU_ENABLED !== "true") return false
  // Authenticate targeting locally. A feature visibility check must not wait
  // on Auth or expose recommendation profile/session capabilities to LD.
  const session = await readWebAuthSessionCookie(
    new NextRequest(request.url, { headers: request.headers }).cookies.get(
      WEB_AUTH_SESSION_COOKIE,
    )?.value,
  )
  return isWatchHomepageRecommendationsEnabled(
    session
      ? {
          kind: "user",
          key: session.subject,
          email: session.email,
          anonymous: false,
          custom: { surface: "watch-homepage-recommendations" },
        }
      : {
          kind: "user",
          key: "watch-anonymous",
          anonymous: true,
          custom: { surface: "watch-homepage-recommendations" },
        },
  )
}
