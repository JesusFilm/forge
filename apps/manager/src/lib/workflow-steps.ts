import type { JobStepState, WorkflowStepName } from "@/types/job"

// The workflow persists only the steps Forge actively owns. Keep this list as
// the shared contract for new jobs, reruns, and UI summaries.
export const FORGE_STEPS: WorkflowStepName[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
  "seo_improvements",
]

export function buildInitialSteps(): JobStepState[] {
  return FORGE_STEPS.map((name) => ({
    name,
    status: "pending",
    retries: 0,
  }))
}

export function formatStepName(step: WorkflowStepName): string {
  if (step === "seo_improvements") {
    return "SEO Improvements"
  }

  return step
    .split("_")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ")
}
