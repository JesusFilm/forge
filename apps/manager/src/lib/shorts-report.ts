// Shorts Studio metadata artifact entry helpers (plan 2026-06-11-002
// decision 2). The `shorts` metadata artifact entry mirrors live phase data
// for the UI/API: `{ kind: "metadata", data: ShortsJobReport }`. Pure module
// (no env, no services) so it is importable from client components, API
// routes, and the durable workflow body alike. Mirrors smart-crop-report.ts.
//
// Single-writer rule: WORKFLOWS own all phase transitions. Routes use
// mergeShortsReport only to set launching intents (e.g. phase "queued" /
// "rendering" stubs at launch time) and must never write terminal phases.

import type {
  JobArtifactManifest,
  JobRecord,
  ShortsJobReport,
  ShortsPhase,
} from "@/types/job"

export const SHORTS_ARTIFACT_KEY = "shorts"

const SHORTS_PHASES = new Set<ShortsPhase>([
  "queued",
  "preparing",
  "ready_for_review",
  "rendering",
  "mux_processing",
  "completed",
  "prepare_failed",
  "render_failed",
])

export function buildShortsMetadataArtifact(
  report: ShortsJobReport,
): JobArtifactManifest {
  // ShortsJobReport is a type alias of an object literal type, so it carries
  // an implicit index signature and widens to the manifest entry's
  // Record<string, unknown> data without casts.
  const data: Record<string, unknown> = report
  return {
    [SHORTS_ARTIFACT_KEY]: {
      kind: "metadata",
      data,
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

export function getShortsReport(
  artifacts: JobArtifactManifest,
): ShortsJobReport | null {
  const entry = artifacts[SHORTS_ARTIFACT_KEY]
  if (!entry || entry.kind !== "metadata") {
    return null
  }

  const data = asRecord(entry.data)
  if (
    !data ||
    data.domain !== "shorts" ||
    typeof data.phase !== "string" ||
    !SHORTS_PHASES.has(data.phase as ShortsPhase)
  ) {
    return null
  }

  const output = asRecord(data.output)

  return {
    domain: "shorts",
    phase: data.phase as ShortsPhase,
    annotation: nullableString(data.annotation),
    hasAudio: nullableBoolean(data.hasAudio),
    clipDurationSec: nullableNumber(data.clipDurationSec),
    captionsCount: nullableNumber(data.captionsCount),
    draftVersion:
      typeof data.draftVersion === "number" &&
      Number.isInteger(data.draftVersion) &&
      data.draftVersion >= 0
        ? data.draftVersion
        : 0,
    lastRenderedDraftVersion: nullableNumber(data.lastRenderedDraftVersion),
    lastRenderedPropsHash: nullableString(data.lastRenderedPropsHash),
    output: {
      muxAssetId: nullableString(output?.muxAssetId),
      playbackId: nullableString(output?.playbackId),
      ready: output?.ready === true,
    },
    updatedAt:
      typeof data.updatedAt === "string"
        ? data.updatedAt
        : new Date(0).toISOString(),
  }
}

export function readShortsReport(
  job: Pick<JobRecord, "artifacts">,
): ShortsJobReport | null {
  return getShortsReport(job.artifacts)
}

export type ShortsReportPatch = Partial<
  Omit<ShortsJobReport, "domain" | "updatedAt">
> & {
  // `output` is replaced atomically when present (its three fields move
  // together — never patch a partial output).
  output?: ShortsJobReport["output"]
}

// Read-modify-write merge: starts from defaults, layers the existing report,
// then the patch, and stamps updatedAt. Callers read the persisted report
// first (workflows via a step, routes via getJob) so fields written by the
// other half of the lifecycle survive — e.g. the render workflow must not
// lose prepare's hasAudio/captionsCount.
export function mergeShortsReport(
  existing: ShortsJobReport | null,
  patch: ShortsReportPatch,
  now: () => Date = () => new Date(),
): ShortsJobReport {
  const base: ShortsJobReport = existing ?? {
    domain: "shorts",
    phase: "queued",
    annotation: null,
    hasAudio: null,
    clipDurationSec: null,
    captionsCount: null,
    draftVersion: 0,
    lastRenderedDraftVersion: null,
    lastRenderedPropsHash: null,
    output: { muxAssetId: null, playbackId: null, ready: false },
    updatedAt: now().toISOString(),
  }

  return {
    ...base,
    ...patch,
    domain: "shorts",
    output: patch.output ? { ...patch.output } : { ...base.output },
    updatedAt: now().toISOString(),
  }
}
