import type { JobStepState, WorkflowStepName } from "@/types/job"

// These steps are persisted at job creation and must stay aligned with the
// Manager job read/write contracts.
export const FORGE_WORKFLOW_STEPS: WorkflowStepName[] = [
  "audio_cleanup",
  "transcription",
  "structured_transcript",
  "translation",
  "chapters",
  "metadata",
  "embeddings",
  "mux_upload",
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

// Smart Crop step inventories (plan 2026-06-09-002 "Durable workflows").
// Persisted at smart-crop job creation; FORGE_WORKFLOW_STEPS is unchanged.
export const SMART_CROP_CANONICAL_STEPS: WorkflowStepName[] = [
  "smart_crop_fingerprint",
  "smart_crop_plan",
  "smart_crop_preview_render",
  "smart_crop_qa",
]

export const SMART_CROP_LOCALIZED_STEPS: WorkflowStepName[] = [
  "smart_crop_fingerprint",
  "smart_crop_align",
  "smart_crop_preview_render",
  "smart_crop_qa",
  "smart_crop_render",
  "smart_crop_mux_output",
]

export function buildSmartCropInitialSteps(
  kind: "canonical" | "localized",
): JobStepState[] {
  const names =
    kind === "canonical"
      ? SMART_CROP_CANONICAL_STEPS
      : SMART_CROP_LOCALIZED_STEPS

  return names.map((name) => ({
    name,
    status: "pending" as const,
    retries: 0,
  }))
}

// Shorts Studio step inventories (plan 2026-06-11-002 "Manager changes").
// Persisted at shorts job creation (kind "prepare") and at render launch
// (kind "render" — the render route resets/replaces the render-step subset
// in place per the lifecycle contract, prepare steps preserved).
export const SHORTS_PREPARE_STEPS: WorkflowStepName[] = ["shorts_prepare"]

export const SHORTS_RENDER_STEPS: WorkflowStepName[] = [
  "shorts_render",
  "shorts_mux_output",
]

export function buildShortsInitialSteps(
  kind: "prepare" | "render",
): JobStepState[] {
  const names = kind === "prepare" ? SHORTS_PREPARE_STEPS : SHORTS_RENDER_STEPS

  return names.map((name) => ({
    name,
    status: "pending" as const,
    retries: 0,
  }))
}

// Lifecycle contract (plan 2026-06-11-002 decision 2): a launch
// resets/replaces ITS step subset in place — the other kind's steps are
// preserved as history, and no duplicate step rows accumulate across
// re-launches. Render steps live after prepare steps; the prepare subset is
// re-inserted at the head so the visual order stays prepare → render.
export function resetShortsStepsForLaunch(
  existing: JobStepState[],
  kind: "prepare" | "render",
): JobStepState[] {
  const names: WorkflowStepName[] =
    kind === "prepare" ? SHORTS_PREPARE_STEPS : SHORTS_RENDER_STEPS
  const kept = existing.filter((step) => !names.includes(step.name))
  const fresh = buildShortsInitialSteps(kind)

  return kind === "prepare" ? [...fresh, ...kept] : [...kept, ...fresh]
}

export function formatStepName(step: WorkflowStepName): string {
  if (step === "seo_improvements") {
    return "SEO Improvements"
  }

  if (step === "smart_crop_qa") {
    return "Smart Crop QA"
  }

  return step
    .split("_")
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(" ")
}
