// Dispatch-shape tests for `triggerExperienceEmbeddingBackfill`.
//
// These tests assert that the resolver dispatches via `start()` from
// `workflow/api` rather than invoking the workflow function directly.
// Workflow-body tests live in
// `src/workflows/experienceEmbeddingBackfill.test.ts`; they exercise
// the function internals in the inert-directive test mode, which
// cannot catch a missing `start()` wrapper.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("workflow/api", () => ({ start }))

// Import under test AFTER the mock so the module resolves to the spy.
import { dispatchExperienceEmbeddingBackfill } from "./experience-embedding-backfill"
import {
  runExperienceEmbeddingBackfill,
  type ExperienceEmbeddingBackfillReport,
} from "@/workflows/experienceEmbeddingBackfill"

const dispatch = wrapStartSpy<ExperienceEmbeddingBackfillReport>(start)

const BASE_REPORT: ExperienceEmbeddingBackfillReport = {
  totalTargets: 1,
  experienceIdFilter: null,
  localeFilter: ["en"],
  force: false,
  outcomes: [],
  succeeded: 1,
  failed: 0,
}

describe("dispatchExperienceEmbeddingBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dispatches via start() with the workflow function and args tuple", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    const report = await dispatchExperienceEmbeddingBackfill({
      experienceIds: ["exp-1"],
      bcp47Locales: ["en"],
      force: false,
    })

    dispatch.expectDispatched(runExperienceEmbeddingBackfill, [
      {
        experienceIds: ["exp-1"],
        bcp47Locales: ["en"],
        force: false,
      },
    ])
    expect(report).toEqual(BASE_REPORT)
  })

  it("passes through undefined optional filters without coercion", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchExperienceEmbeddingBackfill({})

    dispatch.expectDispatched(runExperienceEmbeddingBackfill, [{}])
  })

  it("propagates workflow rejections as thrown errors", async () => {
    const boom = new Error("provider unavailable")
    dispatch.mockRejection(boom)

    await expect(
      dispatchExperienceEmbeddingBackfill({ force: true }),
    ).rejects.toBe(boom)
  })

  it("invokes start() exactly once per dispatch call", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchExperienceEmbeddingBackfill({})

    expect(dispatch.spy).toHaveBeenCalledTimes(1)
  })
})
