import { z } from "zod"
import { env } from "@/config/env"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"
import { studioRenderClient } from "./studio-render-transport"
import {
  createStudioMuxAsset,
  observeStudioMuxAsset,
} from "./studio-render-mux"
import { runStudioMuxCandidate, type StudioMuxPort } from "./studio-mux-runner"
import { StudioRenderRunError } from "./studio-render-runner"

const jobSchema = z.object({
  id: z.string(),
  state: z.string(),
  dispatchId: z.string().nullable(),
  assetId: z.string().nullable(),
  snapshot: z.object({ manifest: studioCatalogRenderManifestSchema }),
})
const candidateSchema = z
  .array(z.object({ id: z.string(), createdAt: z.iso.datetime() }))
  .max(100)
export type StudioMuxCursor = { id: string; createdAt: string } | null

function muxPort(signal: AbortSignal): StudioMuxPort {
  const { call } = studioRenderClient(signal)
  return {
    read: async (id) => jobSchema.parse(await call("mux-enqueue", id)),
    source: async (id) => {
      const job = jobSchema.parse(await call("mux-read", id))
      const grant = z
        .object({ path: z.string() })
        .parse(await call("asset-read", job.snapshot.manifest.output))
      if (
        !/^\/api\/shorts\/assets\/transfer\/[a-f0-9]{64}$/.test(grant.path) ||
        !env.STUDIO_ASSET_INGEST_ORIGIN
      )
        throw new StudioRenderRunError(
          "Public retained-asset ingest origin required",
        )
      const origin = new URL(env.STUDIO_ASSET_INGEST_ORIGIN)
      if (
        origin.protocol !== "https:" ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash ||
        origin.hostname.endsWith(".internal")
      )
        throw new StudioRenderRunError(
          "Invalid public retained-asset ingest origin",
        )
      return new URL(grant.path, origin).href
    },
    claim: async (id) =>
      z
        .object({ execute: z.boolean(), dispatchId: z.string().nullable() })
        .parse(await call("mux-claim", id)),
    create: (url, intentId) => createStudioMuxAsset(url, intentId, signal),
    created: (id, dispatchId, assetId) =>
      call("mux-created", { id, dispatchId, assetId }),
    ambiguous: (id, dispatchId) => call("mux-ambiguous", { id, dispatchId }),
    observe: (assetId, intentId) =>
      observeStudioMuxAsset(assetId, intentId, signal),
    ready: (id, evidence) => call("mux-ready", { id, evidence }),
    stage: (attemptId) => call("mux-stage", attemptId),
  }
}

/** At most five candidates per tick, advancing past errors and long-processing
 * assets with a keyset cursor. Restart safely rescans consumed durable intents. */
export async function dispatchStudioMux(
  signal: AbortSignal,
  cursor: StudioMuxCursor,
): Promise<StudioMuxCursor> {
  if (env.STUDIO_MUX_INGEST_ENABLED !== "true") return cursor
  await studioRenderClient(signal).call("watch-reconcile", null)
  const candidates = candidateSchema.parse(
    await studioRenderClient(signal).call("mux-pending", cursor),
  )
  if (!candidates.length) return null
  let next = cursor
  for (const candidate of candidates.slice(0, 5)) {
    signal.throwIfAborted()
    next = candidate
    try {
      await runStudioMuxCandidate(
        candidate.id,
        muxPort(AbortSignal.any([signal, AbortSignal.timeout(60000)])),
      )
    } catch {
      if (signal.aborted) return next
      console.warn(
        "[studio-mux] Candidate unresolved; retained state requires reconciliation",
      )
    }
  }
  return next
}

let running = false
export function startStudioMuxDispatcher() {
  if (running || env.STUDIO_MUX_INGEST_ENABLED !== "true") return
  running = true
  const stop = new AbortController(),
    shutdown = () => stop.abort()
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
  void (async () => {
    const { setTimeout: wait } = await import("node:timers/promises")
    let cursor: StudioMuxCursor = null
    try {
      while (!stop.signal.aborted) {
        try {
          cursor = await dispatchStudioMux(stop.signal, cursor)
        } catch {
          if (!stop.signal.aborted)
            console.warn("[studio-mux] Canonical scan unavailable")
        }
        await wait(10000, undefined, { signal: stop.signal, ref: false })
      }
    } catch {
      /* Shutdown preserves consumed intents for restart reconciliation. */
    } finally {
      running = false
      process.removeListener("SIGTERM", shutdown)
      process.removeListener("SIGINT", shutdown)
    }
  })()
}
