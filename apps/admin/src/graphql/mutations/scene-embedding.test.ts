// Dispatch-shape tests for `triggerSceneEmbeddingBackfill`.
//
// These tests assert that the resolver dispatches via `start()` from
// `workflow/api` rather than invoking the workflow function directly.
// Workflow-body tests live in `src/workflows/sceneEmbeddingBackfill.test.ts`;
// they exercise the function internals in the inert-directive test mode,
// which cannot catch a missing `start()` wrapper.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("workflow/api", () => ({ start }))

// Import under test AFTER the mock so the module resolves to the spy.
import { dispatchSceneEmbeddingBackfill } from "./scene-embedding"
import {
  runSceneEmbeddingBackfill,
  type SceneEmbeddingBackfillReport,
} from "@/workflows/sceneEmbeddingBackfill"

const dispatch = wrapStartSpy<SceneEmbeddingBackfillReport>(start)

const BASE_REPORT: SceneEmbeddingBackfillReport = {
  mappingGeneratedAt: "2026-04-21T00:00:00.000Z",
  totalTargets: 1,
  localeFilter: ["en"],
  outcomes: [],
  succeeded: 1,
  skipped: 0,
  failed: 0,
  missingArtifacts: [],
  retrySelection: null,
  groupedFailures: [],
}

describe("dispatchSceneEmbeddingBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dispatches via start() with the workflow function and args tuple", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    const report = await dispatchSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
      coreIds: ["core-1"],
      locales: ["en"],
    })

    dispatch.expectDispatched(runSceneEmbeddingBackfill, [
      {
        mappingS3Key: "admin-migrations/core-id-mapping.json",
        coreIds: ["core-1"],
        locales: ["en"],
      },
    ])
    expect(report).toEqual(BASE_REPORT)
  })

  it("passes through undefined optional filters without coercion", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    dispatch.expectDispatched(runSceneEmbeddingBackfill, [
      { mappingS3Key: "admin-migrations/core-id-mapping.json" },
    ])
  })

  it("propagates workflow rejections as thrown errors", async () => {
    const boom = new Error("mapping not found")
    dispatch.mockRejection(boom)

    await expect(
      dispatchSceneEmbeddingBackfill({
        mappingS3Key: "admin-migrations/missing.json",
      }),
    ).rejects.toBe(boom)
  })

  it("invokes start() exactly once per dispatch call", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchSceneEmbeddingBackfill({
      mappingS3Key: "admin-migrations/core-id-mapping.json",
    })

    expect(dispatch.spy).toHaveBeenCalledTimes(1)
  })
})
