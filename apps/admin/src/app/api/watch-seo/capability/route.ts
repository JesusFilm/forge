import { prisma } from "@/db/client"
import { authorizeWatchSeoRequest } from "@/services/watch-seo/authorization"
import type { WatchSeoCapabilityResponse } from "@/services/watch-seo/contract"
import {
  admitWatchSeoRequest,
  admitWatchSeoSubject,
  logWatchSeoDenial,
  noStoreJson,
  rateLimited,
  WATCH_SEO_CAPABILITY_RATE,
  WATCH_SEO_IP_RATE,
} from "../route-utils"

const ROUTE = "watch-seo-capability"

const DENIED: WatchSeoCapabilityResponse = { canViewWatchSeo: false }
const GRANTED: WatchSeoCapabilityResponse = { canViewWatchSeo: true }

// GET /api/watch-seo/capability — answers one boolean. Every denial is a
// byte-identical 403 so the response cannot be used to tell a bad service key
// from a bad token from a non-Admin. The role is re-read on every request.
export async function GET(request: Request): Promise<Response> {
  if (
    !(await admitWatchSeoRequest(request, `${ROUTE}:ip`, WATCH_SEO_IP_RATE))
  ) {
    return rateLimited()
  }
  const authorization = await authorizeWatchSeoRequest(request, prisma, {
    admitSubject: (subject) =>
      admitWatchSeoSubject(subject, ROUTE, WATCH_SEO_CAPABILITY_RATE),
  })
  if (!authorization.ok) {
    if (authorization.reason === "subject_rate_limited") return rateLimited()
    logWatchSeoDenial(ROUTE, authorization.reason)
    return noStoreJson(DENIED, 403)
  }
  return noStoreJson(GRANTED)
}
