import { describe, expect, it } from "vitest"
import { resolveRunSelectionOutcome } from "./run-selection"

describe("resolveRunSelectionOutcome", () => {
  it("clears the selection and returns success feedback on full success", () => {
    const outcome = resolveRunSelectionOutcome(new Set(["a", "b"]), {
      created: 2,
      failed: 0,
    })

    expect(outcome.nextSelectedIds.size).toBe(0)
    expect(outcome.feedback).toEqual({
      tone: "success",
      message: "2 videos queued to run.",
    })
  })

  it("returns no feedback when nothing was created and nothing failed", () => {
    const outcome = resolveRunSelectionOutcome(new Set(), {
      created: 0,
      failed: 0,
    })

    expect(outcome.nextSelectedIds.size).toBe(0)
    expect(outcome.feedback).toBeNull()
  })

  it("keeps the full selection and returns error feedback on total failure", () => {
    const selected = new Set(["a", "b"])
    const outcome = resolveRunSelectionOutcome(selected, {
      created: 0,
      failed: 2,
    })

    expect(outcome.nextSelectedIds).toEqual(selected)
    expect(outcome.feedback).toEqual({
      tone: "error",
      message: "Failed to queue 2 videos to run.",
    })
  })

  it("keeps the selection and returns neutral feedback on partial failure", () => {
    const selected = new Set(["a", "b", "c"])
    const outcome = resolveRunSelectionOutcome(selected, {
      created: 2,
      failed: 1,
    })

    expect(outcome.nextSelectedIds).toEqual(selected)
    expect(outcome.feedback?.tone).toBe("neutral")
    expect(outcome.feedback?.message).toContain("2 videos queued to run.")
    expect(outcome.feedback?.message).toContain(
      "Failed to queue 1 video to run.",
    )
  })

  it("uses singular wording for a single video", () => {
    const outcome = resolveRunSelectionOutcome(new Set(["a"]), {
      created: 1,
      failed: 0,
    })

    expect(outcome.feedback?.message).toBe("1 video queued to run.")
  })
})
