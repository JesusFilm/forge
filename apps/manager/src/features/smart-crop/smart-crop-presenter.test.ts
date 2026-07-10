import { describe, expect, it } from "vitest"
import type { JobRecord, SmartCropJobReport } from "@/types/job"
import {
  canRetrySmartCropJob,
  canReviewSmartCropPlan,
  deriveSmartCropPhase,
  formatSmartCropPhase,
  getSmartCropJobSummary,
  hasSmartCropPreviewVideo,
  listSmartCropArtifactLinks,
} from "./smart-crop-presenter"

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "mux-1",
    muxPlaybackId: "pb-1",
    languages: [],
    options: {
      smartCrop: {
        kind: "canonical",
        assetId: "asset123",
        targetAspectRatio: "9:16",
        cropMode: "auto",
      },
    },
    status: "running",
    retries: 0,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    artifacts: {},
    steps: [],
    errors: [],
    ...overrides,
  }
}

function buildReportArtifacts(
  report: Partial<SmartCropJobReport>,
): JobRecord["artifacts"] {
  return {
    smartCrop: {
      kind: "metadata",
      data: {
        domain: "smart_crop",
        kind: "canonical",
        phase: "plan",
        ...report,
      } as unknown as Record<string, unknown>,
    },
  }
}

describe("deriveSmartCropPhase", () => {
  it("prefers terminal job status over the metadata phase", () => {
    expect(
      deriveSmartCropPhase(
        { status: "completed" },
        {
          domain: "smart_crop",
          kind: "canonical",
          phase: "qa",
        },
      ),
    ).toBe("completed")
    expect(
      deriveSmartCropPhase(
        { status: "failed" },
        {
          domain: "smart_crop",
          kind: "canonical",
          phase: "plan",
        },
      ),
    ).toBe("failed")
  })

  it("uses the metadata phase while running and queued as fallback", () => {
    expect(
      deriveSmartCropPhase(
        { status: "running" },
        {
          domain: "smart_crop",
          kind: "localized",
          phase: "align",
        },
      ),
    ).toBe("align")
    expect(deriveSmartCropPhase({ status: "pending" }, null)).toBe("queued")
  })
})

describe("getSmartCropJobSummary", () => {
  it("returns null for jobs without smart-crop options", () => {
    expect(getSmartCropJobSummary(buildJob({ options: {} }))).toBeNull()
  })

  it("derives the phase label and surfaces the report", () => {
    const job = buildJob({
      artifacts: buildReportArtifacts({
        phase: "preview_render",
        plan: { segmentCount: 42, approved: false },
        usage: { inputTokens: 10, outputTokens: 2 },
      }),
    })

    const summary = getSmartCropJobSummary(job)
    expect(summary).toMatchObject({
      kind: "canonical",
      assetId: "asset123",
      phase: "preview_render",
      phaseLabel: "Preview render",
    })
    expect(summary?.report?.plan).toEqual({ segmentCount: 42, approved: false })
    expect(summary?.report?.usage).toEqual({ inputTokens: 10, outputTokens: 2 })
  })

  it("labels every phase", () => {
    expect(formatSmartCropPhase("mux_output")).toBe("Mux output")
    expect(formatSmartCropPhase("fingerprint")).toBe("Fingerprinting")
  })
})

describe("action gating", () => {
  it("offers review only for canonical jobs with a plan", () => {
    expect(
      canReviewSmartCropPlan(
        buildJob({
          artifacts: buildReportArtifacts({
            plan: { segmentCount: 3, approved: false },
          }),
        }),
      ),
    ).toBe(true)
    expect(canReviewSmartCropPlan(buildJob())).toBe(false)

    const localized = buildJob({
      options: {
        smartCrop: {
          kind: "localized",
          assetId: "asset456",
          targetAspectRatio: "9:16",
          cropMode: "auto",
          canonicalAssetId: "asset123",
          language: "uk",
        },
      },
      artifacts: {
        smartCrop: {
          kind: "metadata",
          data: {
            domain: "smart_crop",
            kind: "localized",
            phase: "qa",
            plan: { segmentCount: 3, approved: false },
          },
        },
      },
    })
    expect(canReviewSmartCropPlan(localized)).toBe(false)
  })

  it("offers retry only for failed jobs", () => {
    expect(canRetrySmartCropJob({ status: "failed" })).toBe(true)
    expect(canRetrySmartCropJob({ status: "running" })).toBe(false)
  })
})

describe("artifact projection", () => {
  it("lists smart-crop downloadable artifacts with labels and hrefs", () => {
    const job = buildJob({
      artifacts: {
        "smart-crop-plan": { kind: "downloadable" },
        "smart-crop-preview": { kind: "downloadable" },
        transcript: { kind: "downloadable" },
        smartCrop: { kind: "metadata", data: { domain: "smart_crop" } },
      },
    })

    expect(listSmartCropArtifactLinks(job)).toEqual([
      {
        key: "smart-crop-plan",
        label: "Smart Crop plan",
        href: "/api/jobs/job-1/artifacts/smart-crop-plan",
      },
      {
        key: "smart-crop-preview",
        label: "Smart Crop preview video",
        href: "/api/jobs/job-1/artifacts/smart-crop-preview",
      },
    ])
    expect(hasSmartCropPreviewVideo(job)).toBe(true)
    expect(hasSmartCropPreviewVideo(buildJob())).toBe(false)
  })
})
