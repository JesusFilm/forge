// Smart Crop metadata artifact entry helpers (plan 2026-06-09-002).
//
// The `smartCrop` metadata artifact entry mirrors live phase data for the UI:
// `{ kind: "metadata", data: SmartCropJobReport }`. Pure module (no env, no
// services) so it is importable from client components, API routes, and the
// durable workflow body alike.

import type {
  JobArtifactManifest,
  SmartCropJobReport,
  SmartCropKind,
  SmartCropPhase,
  SmartCropQaVerdict,
} from "@/types/job"

export const SMART_CROP_ARTIFACT_KEY = "smartCrop"

export function buildSmartCropMetadataArtifact(
  report: SmartCropJobReport,
): JobArtifactManifest {
  return {
    [SMART_CROP_ARTIFACT_KEY]: {
      kind: "metadata",
      data: report as unknown as Record<string, unknown>,
    },
  }
}

const SMART_CROP_KINDS = new Set<SmartCropKind>(["canonical", "localized"])

const SMART_CROP_PHASES = new Set<SmartCropPhase>([
  "queued",
  "fingerprint",
  "plan",
  "align",
  "preview_render",
  "qa",
  "render",
  "mux_output",
  "completed",
  "failed",
])

const QA_VERDICTS = new Set<SmartCropQaVerdict>([
  "pass",
  "needs_repair",
  "fail",
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function getSmartCropReport(
  artifacts: JobArtifactManifest,
): SmartCropJobReport | null {
  const entry = artifacts[SMART_CROP_ARTIFACT_KEY]
  if (!entry || entry.kind !== "metadata") {
    return null
  }

  const data = asRecord(entry.data)
  if (
    !data ||
    data.domain !== "smart_crop" ||
    typeof data.kind !== "string" ||
    !SMART_CROP_KINDS.has(data.kind as SmartCropKind) ||
    typeof data.phase !== "string" ||
    !SMART_CROP_PHASES.has(data.phase as SmartCropPhase)
  ) {
    return null
  }

  const alignment = asRecord(data.alignment)
  const qa = asRecord(data.qa)
  const plan = asRecord(data.plan)
  const attempts = asRecord(data.attempts)
  const output = asRecord(data.output)
  const usage = asRecord(data.usage)

  return {
    domain: "smart_crop",
    kind: data.kind as SmartCropKind,
    phase: data.phase as SmartCropPhase,
    ...(alignment &&
    typeof alignment.overallConfidence === "number" &&
    typeof alignment.unmappedDurationPercent === "number" &&
    typeof alignment.gatePassed === "boolean"
      ? {
          alignment: {
            overallConfidence: alignment.overallConfidence,
            unmappedDurationPercent: alignment.unmappedDurationPercent,
            gatePassed: alignment.gatePassed,
          },
        }
      : {}),
    ...(qa &&
    typeof qa.verdict === "string" &&
    QA_VERDICTS.has(qa.verdict as SmartCropQaVerdict)
      ? { qa: { verdict: qa.verdict as SmartCropQaVerdict } }
      : qa && typeof qa.unavailableReason === "string"
        ? { qa: { unavailableReason: qa.unavailableReason } }
        : {}),
    ...(plan &&
    typeof plan.segmentCount === "number" &&
    typeof plan.approved === "boolean"
      ? {
          plan: {
            segmentCount: plan.segmentCount,
            approved: plan.approved,
          },
        }
      : {}),
    ...(attempts &&
    typeof attempts.latestAttemptIndex === "number" &&
    typeof attempts.maxRepairAttempts === "number" &&
    typeof attempts.repairCount === "number"
      ? {
          attempts: {
            latestAttemptIndex: attempts.latestAttemptIndex,
            selectedAttemptIndex:
              typeof attempts.selectedAttemptIndex === "number"
                ? attempts.selectedAttemptIndex
                : undefined,
            maxRepairAttempts: attempts.maxRepairAttempts,
            repairCount: attempts.repairCount,
            manifestDigest:
              typeof attempts.manifestDigest === "string"
                ? attempts.manifestDigest
                : undefined,
          },
        }
      : {}),
    ...(output && typeof output.muxAssetId === "string"
      ? {
          output: {
            muxAssetId: output.muxAssetId,
            playbackId:
              typeof output.playbackId === "string"
                ? output.playbackId
                : undefined,
          },
        }
      : {}),
    ...(usage &&
    typeof usage.inputTokens === "number" &&
    typeof usage.outputTokens === "number"
      ? {
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          },
        }
      : {}),
  }
}
