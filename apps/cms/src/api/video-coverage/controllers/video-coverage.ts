import type { Core } from "@strapi/strapi"
import { queryVideoCoverage } from "../services/video-coverage"

type StrapiContext = {
  status: number
  body: unknown
  query: Record<string, string | undefined>
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: StrapiContext) {
    const languageIds = ctx.query.languageIds
      ? ctx.query.languageIds.split(",").filter(Boolean)
      : undefined
    const mode = ctx.query.mode === "automation" ? "automation" : "dashboard"

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection

    const videos = await queryVideoCoverage(knex, languageIds, { mode })

    ctx.status = 200
    ctx.body = { videos }
  },
})
