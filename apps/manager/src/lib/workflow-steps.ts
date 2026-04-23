import type { JobOptions, JobStepState, WorkflowStepName } from "@/types/job"

// Forge uses only 5 of the 12 VideoForge steps. The UI components reference
// the full WorkflowStepName union for display, but only these steps are
// created at job time and executed by the workflow.
const FORGE_STEPS: WorkflowStepName[] = [
  "transcription",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "voiceover",
]

export function buildInitialSteps(options: JobOptions = {}): JobStepState[] {
  return FORGE_STEPS.map((name) => ({
    name,
    status:
      name === "voiceover" && !options.generateVoiceover
        ? "skipped"
        : "pending",
    retries: 0,
  }))
}

export function formatStepName(step: WorkflowStepName): string {
  return step
    .split("_")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ")
}
