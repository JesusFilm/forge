import type { Core } from "@strapi/strapi"
import {
  sanitizeSlug,
  suggestAlternativeSlugs,
} from "../../../lib/sanitize-slug"

type StrapiContext = {
  status: number
  body: unknown
  query: Record<string, string | undefined>
  request: {
    header: Record<string, string | undefined>
    body?: Record<string, unknown>
  }
}

function validateToken(ctx: StrapiContext): boolean {
  const token = ctx.request.header["x-seed-studio-token"]
  const expected = process.env.SEED_STUDIO_API_TOKEN
  if (!expected || token !== expected) {
    ctx.status = 401
    ctx.body = { error: "Invalid or missing X-Seed-Studio-Token" }
    return false
  }
  return true
}

/**
 * Heuristic for spotting the Strapi Document Service uniqueness error. The
 * exception class is internal to @strapi/utils and is not stable across
 * minor versions, so we match on the message content instead of `instanceof`.
 */
function isSlugUniquenessError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const haystack = `${err.name} ${err.message}`.toLowerCase()
  if (!haystack.includes("unique")) return false
  // Must also mention the slug field — the lifecycle has a handful of other
  // uniqueness constraints (e.g. homepage pins) that we shouldn't swallow.
  return haystack.includes("slug") || haystack.includes("pathsegment")
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async searchVideos(ctx: StrapiContext) {
    if (!validateToken(ctx)) return

    const body = ctx.request.body ?? {}
    const query = typeof body.query === "string" ? body.query : ""
    const tags =
      Array.isArray(body.tags) &&
      body.tags.every((t: unknown) => typeof t === "string")
        ? (body.tags as string[])
        : undefined
    const locale = typeof body.locale === "string" ? body.locale : "en"

    if (!query) {
      ctx.status = 400
      ctx.body = { error: "Missing required field: query" }
      return
    }

    const service = strapi.service("api::seed-studio.seed-studio")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await (service as any).searchVideos(query, tags, locale)

    ctx.status = 200
    ctx.body = { videos: results }
  },

  async publishExperience(ctx: StrapiContext) {
    if (!validateToken(ctx)) return

    const body = ctx.request.body ?? {}
    const { title, slug, metaDescription, blocks, platformOrdering, locale } =
      body as Record<string, unknown>

    if (typeof title !== "string" || !title) {
      ctx.status = 400
      ctx.body = { error: "Missing required field: title" }
      return
    }
    if (typeof slug !== "string" || !slug) {
      ctx.status = 400
      ctx.body = { error: "Missing required field: slug" }
      return
    }
    if (!Array.isArray(blocks) || blocks.length === 0) {
      ctx.status = 400
      ctx.body = { error: "Missing required field: blocks (non-empty array)" }
      return
    }

    const service = strapi.service("api::seed-studio.seed-studio")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = service as any

    const resolvedLocale = typeof locale === "string" ? locale : "en"

    try {
      const result = await svc.publishExperience({
        title,
        slug,
        metaDescription:
          typeof metaDescription === "string" ? metaDescription : undefined,
        blocks,
        platformOrdering: platformOrdering ?? undefined,
        locale: resolvedLocale,
      })
      ctx.status = 201
      ctx.body = result
      return
    } catch (err) {
      // Surface structured validation errors without treating them as 5xx.
      if (err instanceof Error && err.name === "InvalidSlugError") {
        const reason = (err as Error & { reason?: string }).reason
        ctx.status = 400
        ctx.body = {
          error: {
            message: err.message,
            code: "INVALID_SLUG",
            reason,
          },
        }
        return
      }

      if (isSlugUniquenessError(err)) {
        // Offer a handful of non-colliding suggestions based on the
        // sanitized slug. If sanitize itself fails we still return the 409
        // without suggestions — the author will already have been shown
        // the 400 on a prior attempt, so hitting the uniqueness branch
        // with an invalid slug is a best-effort corner case.
        const sanitized = sanitizeSlug(slug)
        const basis = sanitized.ok ? sanitized.slug : slug
        let suggestions: string[] = []
        try {
          const taken: string[] = await svc.findSlugsStartingWith(
            basis,
            resolvedLocale,
            10,
          )
          suggestions = suggestAlternativeSlugs(basis, taken)
        } catch {
          suggestions = suggestAlternativeSlugs(basis, [basis])
        }
        ctx.status = 409
        ctx.body = {
          error: {
            message: "Slug already exists",
            code: "SLUG_TAKEN",
            suggestions,
          },
        }
        return
      }

      strapi.log.error(
        `[seed-studio] publishExperience failed for slug="${slug}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = (err as any)?.details
      if (details) {
        strapi.log.error(
          `[seed-studio] validation details: ${JSON.stringify(details)}`,
        )
      }
      throw err
    }
  },

  async videoCatalogStats(ctx: StrapiContext) {
    if (!validateToken(ctx)) return

    const service = strapi.service("api::seed-studio.seed-studio")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await (service as any).getVideoCatalogStats()

    ctx.status = 200
    ctx.body = stats
  },
})
