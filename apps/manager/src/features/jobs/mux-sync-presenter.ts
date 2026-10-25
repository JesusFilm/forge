import { getMuxSyncReport } from "@/lib/mux-sync-report"
import type { JobRecord, MuxSyncComparison } from "@/types/job"

export function getPresentedMuxSyncComparisons(
  job: JobRecord,
): MuxSyncComparison[] {
  const report = getMuxSyncReport(job.artifacts)
  if (!report) {
    return []
  }

  return [...report.comparisons].sort((left, right) => {
    if (left.targetLanguage === right.targetLanguage) {
      return left.artifactKey.localeCompare(right.artifactKey)
    }
    return left.targetLanguage.localeCompare(right.targetLanguage)
  })
}

export function getPresentedMuxSyncComparison(
  job: JobRecord,
  artifactKey: string,
): MuxSyncComparison | undefined {
  return getPresentedMuxSyncComparisons(job).find(
    (comparison) => comparison.artifactKey === artifactKey,
  )
}
