import type { JobStepState, WorkflowStepName } from "@/types/job"

// These steps are persisted at job creation and must stay aligned with the CMS
// component enum plus the generated GraphQL contract.
export const FORGE_WORKFLOW_STEPS: WorkflowStepName[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
  "audio_cleanup",
  "theology_validation_bible_quotes",
  "seo_improvements",
]

const SKIPPED_PLACEHOLDER_STEPS: WorkflowStepName[] = [
  "theology_validation_bible_quotes",
  "seo_improvements",
]

export function buildInitialSteps(): JobStepState[] {
  return FORGE_WORKFLOW_STEPS.map((name) => ({
    name,
    status: SKIPPED_PLACEHOLDER_STEPS.includes(name) ? "skipped" : "pending",
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
