import type { Core } from "@strapi/strapi"

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
    const result = await (service as any).publishExperience({
      title,
      slug,
      metaDescription:
        typeof metaDescription === "string" ? metaDescription : undefined,
      blocks,
      platformOrdering: platformOrdering ?? undefined,
      locale: typeof locale === "string" ? locale : "en",
    })

    ctx.status = 201
    ctx.body = result
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
