import type { JobStepState, WorkflowStepName } from "@/types/job"

// These steps are persisted at job creation and must stay aligned with the
// Manager job read/write contracts.
export const FORGE_WORKFLOW_STEPS = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
  "audio_cleanup",
  "theology_validation_bible_quotes",
  "seo_improvements",
] as const satisfies readonly WorkflowStepName[]

const SKIPPED_PLACEHOLDER_STEPS = [
  "theology_validation_bible_quotes",
  "seo_improvements",
] as const satisfies readonly WorkflowStepName[]

const SKIPPED_PLACEHOLDER_STEP_SET = new Set<WorkflowStepName>(
  SKIPPED_PLACEHOLDER_STEPS,
)

export function buildInitialSteps(): JobStepState[] {
  return FORGE_WORKFLOW_STEPS.map((name) => ({
    name,
    status: SKIPPED_PLACEHOLDER_STEP_SET.has(name) ? "skipped" : "pending",
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
