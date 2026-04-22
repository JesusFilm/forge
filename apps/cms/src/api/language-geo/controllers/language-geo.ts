import type { Core } from "@strapi/strapi"
import { queryLanguageGeo } from "../services/language-geo"

type StrapiContext = {
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: StrapiContext) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knex = (strapi.db as any).connection

    const data = await queryLanguageGeo(knex)

    ctx.status = 200
    ctx.body = data
  },
})
