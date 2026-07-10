// Pure presenter logic for the Smart Crop dashboard (status/phase derivation,
// artifact link projection). Kept free of React so it is unit-testable.

import {
  buildJobArtifactHref,
  formatJobArtifactLabel,
} from "@/lib/job-artifacts"
import { getSmartCropReport } from "@/lib/smart-crop-report"
import type {
  JobRecord,
  SmartCropJobReport,
  SmartCropKind,
  SmartCropPhase,
} from "@/types/job"

export type SmartCropJobSummary = {
  kind: SmartCropKind
  assetId: string
  language?: string
  canonicalAssetId?: string
  phase: SmartCropPhase
  phaseLabel: string
  report: SmartCropJobReport | null
}

// Job status wins over the (possibly stale) metadata phase for terminal
// states; otherwise the metadata entry carries the live phase.
export function deriveSmartCropPhase(
  job: Pick<JobRecord, "status">,
  report: SmartCropJobReport | null,
): SmartCropPhase {
  if (job.status === "completed") {
    return "completed"
  }
  if (job.status === "failed") {
    return "failed"
  }
  return report?.phase ?? "queued"
}

export function formatSmartCropPhase(phase: SmartCropPhase): string {
  switch (phase) {
    case "queued":
      return "Queued"
    case "fingerprint":
      return "Fingerprinting"
    case "plan":
      return "Planning"
    case "align":
      return "Aligning"
    case "preview_render":
      return "Preview render"
    case "qa":
      return "QA"
    case "render":
      return "Full render"
    case "mux_output":
      return "Mux output"
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
  }
}

export function getSmartCropJobSummary(
  job: JobRecord,
): SmartCropJobSummary | null {
  const smartCrop = job.options.smartCrop
  if (!smartCrop) {
    return null
  }

  const report = getSmartCropReport(job.artifacts)
  const phase = deriveSmartCropPhase(job, report)

  return {
    kind: smartCrop.kind,
    assetId: smartCrop.assetId,
    language: smartCrop.language,
    canonicalAssetId: smartCrop.canonicalAssetId,
    phase,
    phaseLabel: formatSmartCropPhase(phase),
    report,
  }
}

// Approve/Reject is offered for canonical jobs once a plan exists.
export function canReviewSmartCropPlan(job: JobRecord): boolean {
  const summary = getSmartCropJobSummary(job)
  return summary?.kind === "canonical" && summary.report?.plan != null
}

export function canRetrySmartCropJob(job: Pick<JobRecord, "status">): boolean {
  return job.status === "failed"
}

export type SmartCropArtifactLink = {
  key: string
  label: string
  href: string
}

export function listSmartCropArtifactLinks(
  job: Pick<JobRecord, "id" | "artifacts">,
): SmartCropArtifactLink[] {
  return Object.entries(job.artifacts)
    .filter(
      ([key, entry]) =>
        entry.kind === "downloadable" && key.startsWith("smart-crop-"),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key]) => ({
      key,
      label: formatJobArtifactLabel(key),
      href: buildJobArtifactHref(job.id, key),
    }))
}

export function hasSmartCropPreviewVideo(
  job: Pick<JobRecord, "artifacts">,
): boolean {
  return job.artifacts["smart-crop-preview"]?.kind === "downloadable"
}
