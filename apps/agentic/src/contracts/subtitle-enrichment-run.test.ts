import { describe, expect, it } from "vitest"

import {
  startSubtitleEnrichmentRunRequestSchema,
  startSubtitleEnrichmentRunResponseSchema,
} from "./subtitle-enrichment-run"

const validRequest = {
  jobId: "job-1",
  videoDocumentId: "video-1",
  assetId: "asset-1",
  muxAssetId: "mux-asset-1",
  muxPlaybackId: "mux-playback-1",
  sourceLanguage: "en",
  targetLanguage: "fr",
  materialization: {
    mode: "direct_mux_asset_reuse",
    targetEnvironment: "mux-production",
  },
  requestedTranscriptionProvider: "automatic",
  initialArtifacts: {
    sourceVtt: "s3://bucket/source.vtt",
  },
  requestedBy: { kind: "manager_user", id: "42" },
  idempotencyKey: "manager:job-1:subtitle:fr",
}

describe("subtitle enrichment run contracts", () => {
  it("accepts a start request with one target language", () => {
    expect(
      startSubtitleEnrichmentRunRequestSchema.parse(validRequest),
    ).toMatchObject({
      jobId: "job-1",
      targetLanguage: "fr",
    })
  })

  it("rejects plural target languages in V1", () => {
    expect(
      startSubtitleEnrichmentRunRequestSchema.safeParse({
        ...validRequest,
        targetLanguages: ["fr", "es"],
      }).success,
    ).toBe(false)
  })

  it("rejects malformed materialization", () => {
    expect(
      startSubtitleEnrichmentRunRequestSchema.safeParse({
        ...validRequest,
        materialization: {
          mode: "manager_local_copy",
          targetEnvironment: "mux-dev",
        },
      }).success,
    ).toBe(false)
  })

  it("validates typed success and failure responses", () => {
    expect(
      startSubtitleEnrichmentRunResponseSchema.parse({
        ok: true,
        agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
        managerJobId: "job-1",
        status: "queued",
        summary: "Subtitle enrichment run queued.",
      }),
    ).toMatchObject({
      ok: true,
      managerJobId: "job-1",
    })

    expect(
      startSubtitleEnrichmentRunResponseSchema.parse({
        ok: false,
        code: "idempotency_conflict",
        message: "Idempotency key already belongs to a different request.",
      }),
    ).toMatchObject({
      ok: false,
      code: "idempotency_conflict",
    })
  })
})
