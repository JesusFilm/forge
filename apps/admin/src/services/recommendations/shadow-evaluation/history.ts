import type { PrismaClient } from "@prisma/client"
import { runRecommendationRetrievalQuery } from "../delivery-runtime"
import { getRecommendationRecentContext } from "../recent-context.service"
import type { RecommendationSlateComposition } from "../slate"

export type ShadowHistory = Readonly<{
  status:
    | "request_window_reconstruction"
    | "retention_incomplete"
    | "unavailable"
  recentVideos: NonNullable<RecommendationSlateComposition["recentVideos"]>
}>

/** Offline reconstruction, never a claim that history was captured at serving. */
export async function reconstructShadowHistory(
  prisma: PrismaClient,
  request: { sessionDigest: string; createdAt: Date; expiresAt: Date },
  now: Date,
): Promise<ShadowHistory> {
  const unavailable: ShadowHistory = { status: "unavailable", recentVideos: [] }
  if (
    !(request.createdAt instanceof Date) ||
    !(request.expiresAt instanceof Date) ||
    !/^[a-f0-9]{64}$/.test(request.sessionDigest) ||
    request.createdAt > now ||
    request.expiresAt <= now
  )
    return unavailable
  // The seven-day lookback must still fit inside the 29-day raw retention.
  if (now.getTime() - request.createdAt.getTime() >= 22 * 86_400_000) {
    return { status: "retention_incomplete", recentVideos: [] }
  }
  try {
    const history = await runRecommendationRetrievalQuery(
      prisma,
      Date.now() + 200,
      (tx) =>
        getRecommendationRecentContext(tx, {
          sessionDigest: request.sessionDigest,
          profileTokenDigest: null,
          allowDurableProfileLinks: false,
          // Exclude this request and any subsequent receipt, even when evaluation
          // runs days later. Same-session scope needs no recovered bearer token.
          now: new Date(request.createdAt.getTime() - 1),
        }),
    )
    return {
      status: "request_window_reconstruction",
      recentVideos: history.videos,
    }
  } catch {
    return unavailable
  }
}
