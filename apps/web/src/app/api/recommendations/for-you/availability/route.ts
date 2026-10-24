import { homepageRecommendationsEnabled } from "@/lib/homepage-recommendations-flag"
import { recommendationJson } from "@/lib/recommendation-route-response"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    return recommendationJson({
      enabled: await homepageRecommendationsEnabled(request),
    })
  } catch {
    return recommendationJson({ enabled: false }, 503)
  }
}
