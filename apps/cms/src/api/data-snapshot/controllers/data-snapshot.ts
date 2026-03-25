import type { Core } from "@strapi/strapi"
import {
  createSnapshot,
  getLatestDownloadUrl,
  getSnapshotStatus,
} from "../services/data-snapshot"

type StrapiContext = {
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    // Fire and forget — snapshot runs in background
    createSnapshot(strapi).catch((error) => {
      strapi.log.error(
        `[data-snapshot] Background snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    ctx.status = 202
    ctx.body = {
      message: "Snapshot export started",
      status: getSnapshotStatus(),
    }
  },

  async download(ctx: StrapiContext) {
    const result = await getLatestDownloadUrl(strapi)

    if (!result) {
      ctx.status = 404
      ctx.body = { error: "No snapshot available" }
      return
    }

    const { url, key } = result

    ctx.status = 200
    ctx.body = { url, key }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSnapshotStatus()
  },
})
