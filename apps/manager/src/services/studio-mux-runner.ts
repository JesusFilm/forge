import { StudioRenderRunError } from "./studio-render-runner"
export interface StudioMuxPort {
  read(attemptId: string): Promise<{
    id: string
    state: string
    dispatchId: string | null
    uploadId: string | null
    assetId: string | null
  }>
  upload(
    uploadId: string,
  ): Promise<{ id: string; status: string; asset_id?: string }>
  failed(id: string, uploadId: string): Promise<unknown>
  created(id: string, dispatchId: string, assetId: string): Promise<unknown>
  observe(assetId: string, intentId: string): Promise<{ status: string }>
  ready(id: string, evidence: unknown): Promise<unknown>
  stage(attemptId: string): Promise<unknown>
}
/** Observation only: the render host initiates the direct upload. Never create
 * an asset by pulling a retained Forge URL or replacing an uncertain upload. */
export async function runStudioMuxCandidate(
  attemptId: string,
  port: StudioMuxPort,
) {
  const job = await port.read(attemptId)
  if (job.state === "UPLOADING" && job.uploadId && job.dispatchId) {
    const upload = await port.upload(job.uploadId)
    if (upload.id !== job.uploadId)
      throw new StudioRenderRunError("Mux upload identity changed")
    if (upload.asset_id)
      await port.created(job.id, job.dispatchId, upload.asset_id)
    else if (["errored", "timed_out", "cancelled"].includes(upload.status))
      await port.failed(job.id, job.uploadId)
    return
  }
  if (job.state === "PROCESSING" && job.assetId) {
    const observed = await port.observe(job.assetId, job.id)
    if (observed.status === "ready") {
      await port.ready(job.id, observed)
      await port.stage(attemptId)
    }
  } else if (job.state === "READY") await port.stage(attemptId)
}
