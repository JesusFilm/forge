import type { Core } from "@strapi/strapi"
import { seedEaster } from "../../../bootstrap/seed-easter"

type StrapiContext = {
  status: number
  body: unknown
}

type SeedStatus = {
  state: "idle" | "running" | "done" | "failed"
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

let seedStatus: SeedStatus = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  error: null,
}

export function getSeedStatus(): SeedStatus {
  return { ...seedStatus }
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async trigger(ctx: StrapiContext) {
    if (seedStatus.state === "running") {
      ctx.status = 409
      ctx.body = {
        error: "Seed already in progress",
        status: getSeedStatus(),
      }
      return
    }

    seedStatus = {
      state: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    }

    // Fire and forget — seed runs in background
    seedEaster(strapi)
      .then(() => {
        seedStatus = {
          ...seedStatus,
          state: "done",
          finishedAt: new Date().toISOString(),
        }
        strapi.log.info("[seed-easter] Completed successfully")
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        seedStatus = {
          ...seedStatus,
          state: "failed",
          finishedAt: new Date().toISOString(),
          error: message,
        }
        strapi.log.error(`[seed-easter] Failed: ${message}`)
      })

    ctx.status = 202
    ctx.body = {
      message: "Easter seed started",
      status: getSeedStatus(),
    }
  },

  async status(ctx: StrapiContext) {
    ctx.body = getSeedStatus()
  },
})
