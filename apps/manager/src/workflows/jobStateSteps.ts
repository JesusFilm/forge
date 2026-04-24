import type { WorkflowStepName } from "@/types/job"
import type {
  JobArtifactManifest,
  JobRecord,
  JobStepDetails,
} from "@/types/job"

export async function stepGetJob(jobId: string): Promise<JobRecord | null> {
  "use step"
  const { getJob } = await import("@/lib/state")
  return getJob(jobId)
}

export async function stepUpdateJob(
  jobId: string,
  updates: Partial<
    Pick<
      JobRecord,
      | "status"
      | "currentStep"
      | "artifacts"
      | "errors"
      | "startedAt"
      | "completedAt"
      | "retries"
      | "steps"
    >
  >,
): Promise<JobRecord | null> {
  "use step"
  const { updateJob } = await import("@/lib/state")
  return updateJob(jobId, updates)
}

export async function stepMergeJobArtifacts(
  jobId: string,
  artifacts: JobArtifactManifest,
): Promise<JobRecord | null> {
  "use step"
  const { mergeJobArtifacts } = await import("@/lib/state")
  return mergeJobArtifacts(jobId, artifacts)
}

export async function stepUpdateStepStatus(
  jobId: string,
  stepName: WorkflowStepName,
  status: "pending" | "running" | "completed" | "failed" | "skipped",
  error?: string,
  details?: JobStepDetails,
): Promise<JobRecord | null> {
  "use step"
  const { updateStepStatus } = await import("@/lib/state")
  if (details !== undefined) {
    return updateStepStatus(jobId, stepName, status, error, details)
  }

  if (error !== undefined) {
    return updateStepStatus(jobId, stepName, status, error)
  }

  return updateStepStatus(jobId, stepName, status)
}
