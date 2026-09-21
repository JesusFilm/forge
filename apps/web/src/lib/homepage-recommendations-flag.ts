import "server-only"
import { NextRequest } from "next/server"
import { env } from "@/env"
import {
  WEB_AUTH_SESSION_COOKIE,
  readWebAuthSessionCookie,
} from "@/auth/web-session"
import { isWatchHomepageRecommendationsEnabled } from "@/lib/feature-flags"
import {
  readRecommendationTesterCookie,
  RECOMMENDATION_TESTER_COOKIE,
  RECOMMENDATION_TESTER_CONTEXT_KIND,
} from "@/lib/recommendation-tester-token"

export async function homepageRecommendationsEnabled(
  request: Request,
): Promise<boolean> {
  if (env.WATCH_FOR_YOU_ENABLED !== "true") return false
  const cookies = new NextRequest(request.url, { headers: request.headers })
    .cookies
  const testerId = await readRecommendationTesterCookie(
    cookies.get(RECOMMENDATION_TESTER_COOKIE)?.value,
    {
      secret: env.WATCH_RECOMMENDATION_TESTER_SECRET,
      origin: env.NEXT_PUBLIC_CANONICAL_ORIGIN,
    },
  )
  if (testerId) {
    return isWatchHomepageRecommendationsEnabled({
      kind: RECOMMENDATION_TESTER_CONTEXT_KIND,
      key: testerId,
      anonymous: true,
      custom: { surface: "watch-homepage-recommendations" },
    })
  }
  // Authenticate targeting locally. A feature visibility check must not wait
  // on Auth or expose recommendation profile/session capabilities to LD.
  const session = await readWebAuthSessionCookie(
    cookies.get(WEB_AUTH_SESSION_COOKIE)?.value,
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
