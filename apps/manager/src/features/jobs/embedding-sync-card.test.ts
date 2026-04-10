import { describe, expect, it } from "vitest"
import {
  canOverrideEmbeddingSync,
  getEmbeddingSyncExplanation,
  shouldExpandEmbeddingSyncByDefault,
} from "@/features/jobs/embedding-sync-card"
import type { EmbeddingSyncReport } from "@/types/job"

function buildReport(
  overrides: Partial<EmbeddingSyncReport> = {},
): EmbeddingSyncReport {
  return {
    domain: "embeddings",
    status: "skipped_existing",
    videoDocumentId: "video-doc-1",
    generated: {
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      chunkCount: 2,
      generatedAt: "2026-04-10T12:00:00.000Z",
      contentFingerprint: "sha256:generated",
      hasMetadataEmbedding: true,
    },
    cms: {
      resolvedVideoId: 42,
      hasEmbeddings: true,
      chunkCount: 2,
      model: "openai/text-embedding-3-small",
      contentFingerprint: "sha256:cms",
    },
    ...overrides,
  }
}

describe("canOverrideEmbeddingSync", () => {
  it("returns true only for skipped_existing reports with both fingerprints available", () => {
    expect(canOverrideEmbeddingSync(buildReport())).toBe(true)
    expect(
      canOverrideEmbeddingSync(
        buildReport({
          status: "applied_missing",
        }),
      ),
    ).toBe(false)
    expect(
      canOverrideEmbeddingSync(
        buildReport({
          cms: {
            resolvedVideoId: 42,
            hasEmbeddings: true,
            chunkCount: 2,
          },
        }),
      ),
    ).toBe(false)
    expect(
      canOverrideEmbeddingSync(
        buildReport({
          videoDocumentId: undefined,
        }),
      ),
    ).toBe(false)
  })
})

describe("getEmbeddingSyncExplanation", () => {
  it("explains skipped existing sync reports", () => {
    expect(getEmbeddingSyncExplanation(buildReport())).toContain(
      "automatic overwrite was skipped",
    )
  })

  it("explains unsupported shared workflow runs without a CMS videoDocumentId", () => {
    expect(
      getEmbeddingSyncExplanation(
        buildReport({
          status: "unsupported",
          reason: "no_video_document_id",
        }),
      ),
    ).toContain("no CMS video document ID")
  })
})

describe("shouldExpandEmbeddingSyncByDefault", () => {
  it("expands failed sync reports and keeps successful ones collapsed", () => {
    expect(
      shouldExpandEmbeddingSyncByDefault(
        buildReport({
          status: "failed",
          reason: "video_not_found",
        }),
      ),
    ).toBe(true)
    expect(shouldExpandEmbeddingSyncByDefault(buildReport())).toBe(false)
    expect(shouldExpandEmbeddingSyncByDefault(undefined)).toBe(false)
  })
})
