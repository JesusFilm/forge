import { z } from "zod"
import { env } from "@/config/env"
import { studioCatalogRenderManifestSchema } from "@forge/studio-contracts/catalog"
import { StudioRenderPoolBindingError } from "./studio-render-pool-errors"
import { studioRenderClient } from "./studio-render-transport"
import {
  createStudioMuxUpload,
  observeStudioMuxUpload,
} from "./studio-render-mux"

const jobSchema = z.object({
  id: z.string(),
  state: z.string(),
  dispatchId: z.string().nullable(),
  uploadId: z.string().nullable(),
  assetId: z.string().nullable(),
  snapshot: z.object({
    manifest: studioCatalogRenderManifestSchema,
    leaseId: z.string(),
  }),
})
export async function prepareStudioMuxUpload(
  attemptId: string,
  leaseId: string,
  signal: AbortSignal,
) {
  if (env.STUDIO_MUX_INGEST_ENABLED !== "true") return { state: "disabled" }
  const { call } = studioRenderClient(signal)
  let job = jobSchema.parse(await call("mux-enqueue", attemptId))
  if (
    job.snapshot.leaseId !== leaseId ||
    job.snapshot.manifest.renderAttemptId !== attemptId
  )
    throw new StudioRenderPoolBindingError("Mux render lease changed")
  if (job.state === "PENDING") {
    const claim = z
      .object({ execute: z.boolean(), dispatchId: z.string().nullable() })
      .parse(await call("mux-claim", job.id))
    if (!claim.execute || !claim.dispatchId)
      throw new StudioRenderPoolBindingError("Mux dispatch unavailable")
    try {
      const upload = await createStudioMuxUpload(job.id, signal)
      job = jobSchema.parse(
        await call("mux-upload-created", {
          id: job.id,
          dispatchId: claim.dispatchId,
          uploadId: upload.id,
        }),
      )
    } catch (error) {
      // Never replace a provider upload after an uncertain create or recording.
      await call("mux-ambiguous", {
        id: job.id,
        dispatchId: claim.dispatchId,
      }).catch(() => undefined)
      throw error
    }
  }
  if (job.assetId) return { state: "processing" }
  if (job.state !== "UPLOADING" || !job.uploadId)
    throw new StudioRenderPoolBindingError("Mux upload creation unconfirmed")
  const upload = await observeStudioMuxUpload(job.uploadId, signal)
  if (upload.id !== job.uploadId)
    throw new StudioRenderPoolBindingError("Mux upload identity changed")
  if (upload.asset_id) return { state: "processing" }
  if (upload.status !== "waiting" || !upload.url)
    throw new StudioRenderPoolBindingError("Mux upload unavailable")
  const url = new URL(upload.url)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    !(
      url.hostname === "storage.googleapis.com" ||
      url.hostname === "mux.com" ||
      url.hostname.endsWith(".mux.com")
    )
  )
    throw new StudioRenderPoolBindingError("Mux upload destination refused")
  // Recheck current revision/control after provider waits, before disclosing URL.
  await call("mux-upload-eligible", job.id)
  return {
    state: "upload",
    uploadId: job.uploadId,
    url: url.href,
    digest: job.snapshot.manifest.output.digest,
  }
}
