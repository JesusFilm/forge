import type { JobStepState, WorkflowStepName } from "@/types/job"

// Forge uses only a subset of the VideoForge steps. The UI components reference
// the full WorkflowStepName union for display, but only these steps are
// created at job time.
const FORGE_STEPS: WorkflowStepName[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
]

const SKIPPED_PLACEHOLDER_STEPS: WorkflowStepName[] = [
  "theology_validation_bible_quotes",
]

export function buildInitialSteps(): JobStepState[] {
  return [
    ...FORGE_STEPS.map((name) => ({
      name,
      status: "pending" as const,
      retries: 0,
    })),
    ...SKIPPED_PLACEHOLDER_STEPS.map((name) => ({
      name,
      status: "skipped" as const,
      retries: 0,
    })),
  ]
}

export function formatStepName(step: WorkflowStepName): string {
  return step
    .split("_")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ")
}
