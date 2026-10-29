import { createHash } from "node:crypto"
import { getJob, updateJob } from "@/lib/state"
import { resolveJobArtifactDescriptor } from "@/lib/job-artifacts"
import { openArtifactStream, writeArtifact } from "@/services/storage"
import type { JobRecord } from "@/types/job"

export class EnrichmentArtifactNamespaceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EnrichmentArtifactNamespaceError"
  }
}

export function enrichmentJobAssetId(jobId: string): string {
  return `enrichment-job-${createHash("sha256").update(jobId).digest("hex")}`
}

export function hasReadyEnrichmentNamespace(job: JobRecord): boolean {
  const namespace = job.options.enrichmentArtifacts
  return (
    namespace?.status === "ready" &&
    namespace.assetId === enrichmentJobAssetId(job.id) &&
    typeof namespace.sourceVerified === "boolean" &&
    !job.options.smartCrop &&
    !job.options.shorts
  )
}

type NamespaceDeps = {
  getJob: typeof getJob
  updateJob: typeof updateJob
  openArtifactStream: typeof openArtifactStream
  writeArtifact: typeof writeArtifact
}

/** Persist a CAS-owned preparation latch before copying or dispatching. A crash
 * leaves preparation consumed: readers retain the old prefix, dispatch refuses
 * to recopy over potentially newer outputs. Reconciliation is explicit.
 */
export async function prepareEnrichmentArtifactNamespace(
  jobId: string,
  deps: NamespaceDeps = {
    getJob,
    updateJob,
    openArtifactStream,
    writeArtifact,
  },
): Promise<JobRecord> {
  const job = await deps.getJob(jobId)
  if (!job) throw new EnrichmentArtifactNamespaceError("Job not found")
  if (job.options.enrichmentArtifacts !== undefined) {
    if (!hasReadyEnrichmentNamespace(job))
      throw new EnrichmentArtifactNamespaceError(
        "Artifact namespace is invalid or preparation needs reconciliation",
      )
    return job
  }
  if (job.status === "running" || job.options.smartCrop || job.options.shorts)
    throw new EnrichmentArtifactNamespaceError(
      "Cannot move an active or non-enrichment job's artifacts",
    )

  const revision = job.revision
  if (revision === undefined || !Number.isSafeInteger(revision) || revision < 0)
    throw new EnrichmentArtifactNamespaceError(
      "Artifact preparation requires a durable job revision",
    )

  const entries = Object.entries(job.artifacts).filter(
    ([, entry]) => entry.kind === "downloadable",
  )
  if (entries.length > 256)
    throw new EnrichmentArtifactNamespaceError(
      "Legacy artifact manifest exceeds materialization limit",
    )
  const descriptors = entries.map(([key]) => {
    const descriptor = resolveJobArtifactDescriptor(key)
    if (!descriptor)
      throw new EnrichmentArtifactNamespaceError(
        `Unsupported legacy artifact: ${key}`,
      )
    return descriptor
  })
  const namespace = {
    assetId: enrichmentJobAssetId(job.id),
    status: "preparing" as const,
    sourceVerified: false,
  }
  const options = { ...job.options, enrichmentArtifacts: namespace }
  // Retiring any prior owner also invokes Admin's existing in-flight-operation
  // fence. Revision CAS prevents two Manager replicas owning materialization.
  delete options.currentRunId
  delete options.dispatchedAt
  delete options.callbackSequences
  const preparationRevision = revision + 1
  const preparing = await deps.updateJob(job.id, { options }, revision)
  if (!preparing || preparing.revision !== preparationRevision)
    throw new EnrichmentArtifactNamespaceError(
      "Artifact preparation lost revision ownership",
    )

  let totalBytes = 0
  const copied = new Set<string>()
  for (const descriptor of descriptors) {
    const key = `${descriptor.artifactType}.${descriptor.ext}`
    if (copied.has(key)) continue
    copied.add(key)
    const source = await deps.openArtifactStream({
      assetId: job.muxAssetId,
      artifactType: descriptor.artifactType,
      ext: descriptor.ext,
    })
    const reader = source.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      if (
        source.totalSize > 64 * 1024 * 1024 ||
        totalBytes + source.totalSize > 256 * 1024 * 1024
      )
        throw new EnrichmentArtifactNamespaceError(
          "Legacy artifact bytes exceed materialization limit",
        )
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        totalBytes += value.byteLength
        if (size > 64 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024)
          throw new EnrichmentArtifactNamespaceError(
            "Legacy artifact bytes exceed materialization limit",
          )
        chunks.push(value)
      }
      if (size !== source.totalSize)
        throw new EnrichmentArtifactNamespaceError(
          "Legacy artifact changed during materialization",
        )
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const body = Buffer.concat(chunks)
    await deps.writeArtifact({
      assetId: namespace.assetId,
      ...descriptor,
      body,
    })
  }
  const ready = await deps.updateJob(
    job.id,
    {
      options: {
        ...preparing.options,
        enrichmentArtifacts: { ...namespace, status: "ready" },
      },
    },
    preparationRevision,
  )
  if (
    !ready ||
    ready.revision !== preparationRevision + 1 ||
    !hasReadyEnrichmentNamespace(ready)
  )
    throw new EnrichmentArtifactNamespaceError(
      "Artifact preparation completion lost revision ownership",
    )
  return ready
}
