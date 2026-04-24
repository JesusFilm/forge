// Dispatch-shape tests for `triggerExperienceContentDump`.
//
// These tests assert that the resolver dispatches via `start()` from
// `workflow/api` rather than invoking the workflow function directly.
// Workflow body tests live in
// `src/workflows/experienceContentDump.test.ts`; they exercise the
// function internals in the inert-directive test mode, which cannot
// catch a missing `start()` wrapper. See
// docs/solutions/best-practices/workflow-dispatch-test-mode-divergence-20260421.md.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { wrapStartSpy } from "@/test-helpers/workflow-dispatch"

const { start } = vi.hoisted(() => ({ start: vi.fn() }))

vi.mock("workflow/api", () => ({ start }))

// Imported AFTER the mock so the module resolves to the spy.
import { dispatchExperienceContentDump } from "./experience-content-dump"
import {
  runExperienceContentDump,
  type ExperienceContentDumpReport,
} from "@/workflows/experienceContentDump"

const dispatch = wrapStartSpy<ExperienceContentDumpReport>(start)

const BASE_REPORT: ExperienceContentDumpReport = {
  totalTargets: 1,
  documentIdFilter: null,
  localeFilter: null,
  outcomes: [],
  succeeded: 1,
  skipped: 0,
  failed: 0,
  embedsDispatched: 1,
}

describe("dispatchExperienceContentDump", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("dispatches via start() with the workflow function and args tuple", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    const report = await dispatchExperienceContentDump({
      documentIds: ["doc-1"],
      locales: ["en"],
    })

    dispatch.expectDispatched(runExperienceContentDump, [
      { documentIds: ["doc-1"], locales: ["en"] },
    ])
    expect(report).toEqual(BASE_REPORT)
  })

  it("passes through undefined optional filters without coercion", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchExperienceContentDump({})

    dispatch.expectDispatched(runExperienceContentDump, [{}])
  })

  it("propagates workflow rejections as thrown errors", async () => {
    const boom = new Error("cms unavailable")
    dispatch.mockRejection(boom)

    await expect(
      dispatchExperienceContentDump({ documentIds: ["doc-1"] }),
    ).rejects.toBe(boom)
  })

  it("invokes start() exactly once per dispatch call", async () => {
    dispatch.mockReturnValue(BASE_REPORT)

    await dispatchExperienceContentDump({})

    expect(dispatch.spy).toHaveBeenCalledTimes(1)
  })
})
