import type { Core } from "@strapi/strapi"
import {
  createSnapshot,
  getLatestDownloadUrl,
  getSnapshotStatus,
  getPersistedSnapshotStatus,
  getLocalImportStatus,
} from "../services/data-snapshot"

type StrapiContext = {
  status: number
  body: unknown
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    if (process.env.CORE_SYNC_ENABLED !== "true") {
      ctx.status = 403
      ctx.body = {
        error:
          "Data snapshot can only be triggered in production. Use pnpm data-import to download a snapshot locally.",
      }
      return
    }

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
    const status = getSnapshotStatus()
    const isProduction = process.env.CORE_SYNC_ENABLED === "true"

    // When idle with no in-memory lastRun (e.g. after restart), enrich with
    // persistent metadata from S3 so the UI always shows the latest snapshot info.
    if (isProduction && !status.inProgress && !status.lastRun) {
      const persisted = await getPersistedSnapshotStatus()
      ctx.body = { ...status, ...persisted, isProduction }
      return
    }

    // In non-production, include when the last local data-import was applied
    if (!isProduction) {
      const localImport = await getLocalImportStatus(strapi)
      ctx.body = { ...status, localImport, isProduction }
      return
    }

    ctx.body = { ...status, isProduction }
  },
})
