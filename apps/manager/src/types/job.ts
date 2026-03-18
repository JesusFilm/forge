// Job types — adapted from the original VideoForge types for Forge's enrichment steps.

export type JobStatus = "pending" | "running" | "completed" | "failed"

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

export type WorkflowStepName =
  | "transcription"
  | "translation"
  | "chapters"
  | "metadata"
  | "embeddings"

export interface JobStepState {
  name: WorkflowStepName
  status: StepStatus
  retries: number
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface JobError {
  step: WorkflowStepName
  message: string
  at: string
}

export interface JobRecord {
  id: string
  muxAssetId: string
  muxPlaybackId: string
  languages: string[]
  status: JobStatus
  currentStep?: WorkflowStepName
  retries: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  artifacts: Record<string, string>
  steps: JobStepState[]
  errors: JobError[]
}

export interface JobsDb {
  jobs: JobRecord[]
}
