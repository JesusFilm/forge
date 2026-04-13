import type { Core } from "@strapi/strapi"
import { queryExperienceList } from "../services/experience-list"

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Strapi knex typings are not public
    const knex = (strapi.db as any).connection

    const experiences = await queryExperienceList(knex, languageIds)

    ctx.status = 200
    ctx.body = { experiences }
  },
})
