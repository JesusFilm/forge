import type { Core } from "@strapi/strapi"
import { search } from "../services/search"

type StrapiContext = {
  status: number
  body: unknown
  request: {
    query?: Record<string, string | undefined>
  }
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async search(ctx: StrapiContext) {
    const query = ctx.request.query ?? {}

    const q = query.q
    if (!q || q.trim().length === 0) {
      ctx.status = 400
      ctx.body = { error: "q (search query) is required" }
      return
    }

    const locale = query.locale
    if (!locale) {
      ctx.status = 400
      ctx.body = { error: "locale is required" }
      return
    }

    const limit = query.limit ? Number(query.limit) || undefined : undefined
    const offset = query.offset ? Number(query.offset) || undefined : undefined

    try {
      const result = await search(strapi, {
        query: q.trim(),
        locale,
        limit,
        offset,
      })
      ctx.status = 200
      ctx.body = result
    } catch (error) {
      strapi.log.error(
        `[search] Search failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      ctx.status = 503
      ctx.body = { error: "Search is temporarily unavailable" }
    }
  },
})
