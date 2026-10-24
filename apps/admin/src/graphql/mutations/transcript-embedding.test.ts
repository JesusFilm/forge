// Dispatch-shape tests for `triggerTranscriptEmbeddingBackfill`.
//
// These tests assert that the resolver dispatches via `start()` from
// `workflow/api` rather than invoking the workflow function directly.
// Workflow-body tests live in
// `src/workflows/transcriptEmbeddingBackfill.test.ts`; they exercise
// the function internals in the inert-directive test mode, which
// cannot catch a missing `start()` wrapper. See
// docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("workflow/api", () => ({ start }))

// Import under test AFTER the mock so the module resolves to the spy.
import { dispatchTranscriptEmbeddingBackfill } from "./transcript-embedding"
import {
  runTranscriptEmbeddingBackfill,
  type TranscriptEmbeddingBackfillReport,
} from "@/workflows/transcriptEmbeddingBackfill"

const dispatch = wrapStartSpy<TranscriptEmbeddingBackfillReport>(start)

const BASE_REPORT: TranscriptEmbeddingBackfillReport = {
  mappingGeneratedAt: "2026-04-22T00:00:00.000Z",
  totalTargets: 1,
  languageFilter: null,
  outcomes: [],
  succeeded: 1,
  skipped: 0,
  failed: 0,
  missingArtifacts: [],
  sourceGaps: [],
}

describe("dispatchTranscriptEmbeddingBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dispatches via start() with the workflow function and args tuple", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    const report = await dispatchTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-1"],
      languages: ["en"],
      mode: "force",
    })

    dispatch.expectDispatched(runTranscriptEmbeddingBackfill, [
      {
        mappingS3Key: "admin-migrations/core-id-mapping.json",
        coreIds: ["core-1"],
        languages: ["en"],
        mode: "force",
      },
    ])
    expect(report).toEqual(BASE_REPORT)
  })

  it("passes through undefined optional filters without coercion", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    dispatch.expectDispatched(runTranscriptEmbeddingBackfill, [
      { mappingS3Key: "admin-migrations/core-id-mapping.json" },
    ])
  })

  it("preserves the production resume shape for the latest failure point", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["1_jf-0-0"],
      mode: "model-upgrade",
    })

    dispatch.expectDispatched(runTranscriptEmbeddingBackfill, [
      {
        mappingS3Key: "admin-migrations/core-id-mapping.json",
        coreIds: ["1_jf-0-0"],
        mode: "model-upgrade",
      },
    ])
  })

  it("propagates workflow rejections as thrown errors", async () => {
    const boom = new Error("mapping not found")
    dispatch.mockRejection(boom)

    await expect(
      dispatchTranscriptEmbeddingBackfill({
        mappingS3Key: "admin-migrations/missing.json",
      }),
    ).rejects.toBe(boom)
  })

  it("invokes start() exactly once per dispatch call", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchTranscriptEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(dispatch.spy).toHaveBeenCalledTimes(1)
  })
})
