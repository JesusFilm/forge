import { describe, expect, it } from "vitest"
import {
  buildJobUpdateData,
  mergeArtifactEntries,
  normalizeJobArtifacts,
  toJobRecord,
} from "@/lib/state"
import { getEmbeddingSyncReport } from "@/lib/embedding-sync-report"

describe("buildJobUpdateData", () => {
  it("serializes explicit currentStep clearing as null", () => {
    expect(
      buildJobUpdateData({
        status: "failed",
        currentStep: undefined,
      }),
    ).toEqual({
      status: "failed",
      currentStep: null,
    })
  })

  it("merges new artifact manifest entries without dropping metadata", () => {
    expect(
      mergeArtifactEntries(
        {
          materialization: {
            kind: "metadata",
            data: { sourceVideoCoreId: "video-1" },
          },
          transcript: { kind: "downloadable" },
        },
        {
          chapters: { kind: "downloadable" },
          metadata: { kind: "downloadable" },
        },
      ),
    ).toEqual({
      materialization: {
        kind: "metadata",
        data: { sourceVideoCoreId: "video-1" },
      },
      transcript: { kind: "downloadable" },
      chapters: { kind: "downloadable" },
      metadata: { kind: "downloadable" },
    })
  })

  it("normalizes legacy artifact values into the new manifest shape", () => {
    expect(
      normalizeJobArtifacts({
        transcript: "/api/jobs/job-1/artifacts/transcript",
        materialization:
          '{"mode":"snapshot_to_stage_clone","sourceVideoCoreId":"video-1"}',
      }),
    ).toEqual({
      transcript: { kind: "downloadable" },
      materialization: {
        kind: "metadata",
        data: {
          mode: "snapshot_to_stage_clone",
          sourceVideoCoreId: "video-1",
        },
      },
    })
  })

  it("preserves embedding sync metadata artifacts for downstream UI parsing", () => {
    const artifacts = normalizeJobArtifacts({
      embeddingSync: {
        kind: "metadata",
        data: {
          domain: "embeddings",
          status: "skipped_existing",
          videoDocumentId: "video-doc-1",
          generated: {
            model: "openai/text-embedding-3-small",
            dimensions: 1536,
            chunkCount: 2,
            contentFingerprint: "sha256:generated",
            hasMetadataEmbedding: false,
          },
          cms: {
            resolvedVideoId: 42,
            hasEmbeddings: true,
            chunkCount: 2,
            contentFingerprint: "sha256:cms",
          },
        },
      },
    })

    expect(getEmbeddingSyncReport(artifacts)).toMatchObject({
      status: "skipped_existing",
      videoDocumentId: "video-doc-1",
      cms: {
        resolvedVideoId: 42,
      },
    })
  })
})

describe("toJobRecord", () => {
  it("derives source-language fields from materialization metadata", () => {
    expect(
      toJobRecord({
        documentId: "job-1",
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        languages: ["ru"],
        status: "completed",
        currentStep: "translation",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {
          materialization: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            sourceSelectionReason: "fallback-en",
            primaryRequestedTargetLanguageCode: "ru",
            resolvedTargetLanguageCodes: ["ru"],
          },
        },
        errors: [],
        steps: [],
      } as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      sourceSelectionReason: "fallback-en",
      primaryRequestedTargetLanguageCode: "ru",
      resolvedTargetLanguageCodes: ["ru"],
      artifacts: {
        materialization: {
          kind: "metadata",
          data: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            sourceSelectionReason: "fallback-en",
            primaryRequestedTargetLanguageCode: "ru",
            resolvedTargetLanguageCodes: ["ru"],
          },
        },
      },
    })
  })

  it("derives source-language fields from legacy stringified materialization metadata", () => {
    expect(
      toJobRecord({
        documentId: "job-2",
        muxAssetId: "asset-2",
        muxPlaybackId: "playback-2",
        languages: ["en"],
        status: "completed",
        currentStep: "transcription",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {
          materialization:
            '{"sourceLanguageId":"529","sourceLanguageCode":"en","sourceSelectionReason":"requested"}',
        },
        errors: [],
        steps: [],
      } as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      sourceSelectionReason: "requested",
    })
  })
})
