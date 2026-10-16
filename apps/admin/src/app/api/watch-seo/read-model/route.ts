import { z } from "zod"

import { prisma } from "@/db/client"
import { authorizeWatchSeoRequest } from "@/services/watch-seo/authorization"
import {
  WatchSeoPageNotFoundError,
  WatchSeoReadModelService,
} from "@/services/watch-seo/read-model.service"
import {
  admitWatchSeoRequest,
  admitWatchSeoSubject,
  logWatchSeoDenial,
  noStoreJson,
  rateLimited,
  WATCH_SEO_READ_RATE,
  WATCH_SEO_IP_RATE,
} from "../route-utils"

const ROUTE = "watch-seo-read-model"

// Content and language slugs are catalog identifiers. The pattern is
// intentionally strict (no path separators, whitespace, or control characters)
// because they feed bounded lookups and a derived canonical URL.
const Slug = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,190}$/u)

const Query = z
  .object({
    slug: Slug,
    language: Slug,
    parent: Slug.optional(),
  })
  .strict()

// GET /api/watch-seo/read-model?slug=&language=[&parent=]
// Order is load-bearing: broad IP ceiling → service key and user-token checks →
// verified-subject quota → live Admin lookup → input validation → read.
export async function GET(request: Request): Promise<Response> {
  if (
    !(await admitWatchSeoRequest(request, `${ROUTE}:ip`, WATCH_SEO_IP_RATE))
  ) {
    return rateLimited()
  }
  const authorization = await authorizeWatchSeoRequest(request, prisma, {
    admitSubject: (subject) =>
      admitWatchSeoSubject(subject, ROUTE, WATCH_SEO_READ_RATE),
  })
  if (!authorization.ok) {
    if (authorization.reason === "subject_rate_limited") return rateLimited()
    logWatchSeoDenial(ROUTE, authorization.reason)
    return noStoreJson({ error: "forbidden" }, 403)
  }

  const params = new URL(request.url).searchParams
  const allowed = new Set(["slug", "language", "parent"])
  if ([...params.keys()].some((key) => !allowed.has(key))) {
    return noStoreJson({ error: "invalid_request" }, 400)
  }
  const parsed = Query.safeParse({
    slug: params.get("slug") ?? undefined,
    language: params.get("language") ?? undefined,
    parent: params.get("parent") ?? undefined,
  })
  if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400)

  try {
    const model = await new WatchSeoReadModelService(prisma).read({
      videoSlug: parsed.data.slug,
      languageSlug: parsed.data.language,
      contextualParentSlug: parsed.data.parent ?? null,
    })
    return noStoreJson(model)
  } catch (error) {
    if (error instanceof WatchSeoPageNotFoundError) {
      return noStoreJson({ error: "not_found" }, 404)
    }
    console.error(
      `[watch-seo] event=read_failed error=${error instanceof Error ? error.name : "UnknownError"}`,
    )
    return noStoreJson({ error: "internal_error" }, 500)
  }
}
