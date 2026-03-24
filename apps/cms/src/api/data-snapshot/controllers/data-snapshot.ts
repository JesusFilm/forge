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
    const url = await getLatestDownloadUrl(strapi)

    if (!url) {
      ctx.status = 404
      ctx.body = { error: "No snapshot available" }
      return
    }

    ctx.status = 200
    ctx.body = { url }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSnapshotStatus()
  },
})
