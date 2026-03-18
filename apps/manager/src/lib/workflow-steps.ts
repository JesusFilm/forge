import type { JobStepState, WorkflowStepName } from "@/types/job"

const BASE_STEPS: WorkflowStepName[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
]

export function buildInitialSteps(): JobStepState[] {
  return BASE_STEPS.map((name) => ({
    name,
    status: "pending",
    retries: 0,
  }))
}

export function formatStepName(step: WorkflowStepName): string {
  return step
    .split("_")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ")
}
