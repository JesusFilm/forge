import type { StudioApprovedRelease } from "@forge/studio-contracts/publication"
export type StudioPublicationBinding = StudioApprovedRelease
export type StudioPublicationPreparationPort = {
  eligible: (binding: StudioApprovedRelease) => Promise<void>
  ready: (binding: StudioApprovedRelease, readinessId: string) => Promise<void>
  read: (attemptId: string) => Promise<{
    id: string
    state: string
    assetId: string | null
  }>
  observe: (assetId: string, intentId: string) => Promise<unknown>
  record: (intentId: string, evidence: unknown) => Promise<unknown>
  stage: (attemptId: string) => Promise<{
    releaseId: string
    readinessId: string
  }>
}
class StudioPublicationPreparationError extends Error {}

/** Refresh only an existing signed asset outside the publication transaction.
 * The caller retains the returned readiness ID in its immutable publish command,
 * so an ambiguous submission can retry the exact original receipt after unpublish.
 * This capability cannot create a Mux asset, approve, or publish. */
export async function prepareStudioPublication(
  input: StudioPublicationBinding,
  port: StudioPublicationPreparationPort,
) {
  await port.eligible(input)
  const job = await port.read(input.renderAttemptId)
  if (job.state !== "READY" || !job.assetId)
    throw new StudioPublicationPreparationError("UNREADY")
  const evidence = await port.observe(job.assetId, job.id)
  await port.record(job.id, evidence)
  const prepared = await port.stage(input.renderAttemptId)
  if (prepared.releaseId !== input.releaseId)
    throw new StudioPublicationPreparationError("STALE_BINDING")
  await port.ready(input, prepared.readinessId)
  return prepared
}
