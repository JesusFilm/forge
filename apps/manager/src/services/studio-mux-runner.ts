export interface StudioMuxPort {
  read(attemptId: string): Promise<{
    id: string
    state: string
    dispatchId: string | null
    assetId: string | null
  }>
  source(attemptId: string): Promise<string>
  claim(id: string): Promise<{ execute: boolean; dispatchId: string | null }>
  create(url: string, intentId: string): Promise<{ id: string }>
  created(id: string, dispatchId: string, assetId: string): Promise<unknown>
  ambiguous(id: string, dispatchId: string): Promise<unknown>
  observe(assetId: string, intentId: string): Promise<{ status: string }>
  ready(id: string, evidence: unknown): Promise<unknown>
  stage(attemptId: string): Promise<unknown>
}
/** No retry of an ambiguous paid create. Processing observations remain safe
 * after edits/unpublish; canonical staging/publication revalidate eligibility. */
export async function runStudioMuxCandidate(
  attemptId: string,
  port: StudioMuxPort,
) {
  const job = await port.read(attemptId)
  if (job.state === "PENDING") {
    const url = await port.source(attemptId)
    const claim = await port.claim(job.id)
    if (!claim.execute || !claim.dispatchId) return
    try {
      const asset = await port.create(url, job.id)
      await port.created(job.id, claim.dispatchId, asset.id)
    } catch {
      await port.ambiguous(job.id, claim.dispatchId)
    }
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
