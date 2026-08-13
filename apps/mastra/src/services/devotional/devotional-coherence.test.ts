import { afterEach, describe, expect, it, vi } from "vitest"

import { checkDevotionalCoherence } from "./devotional-coherence"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * This critic shipped with no tests, and it is the one the quality gate consults
 * FIRST: the gate blocks on `skipped` before it looks at `coherent`. That makes
 * the fail-open shape load-bearing — on a double failure the critic returns
 * `coherent: true` so a checker outage never blocks a render, and `skipped: true`
 * is the ONLY thing distinguishing that from a genuine pass. Delete the flag and
 * the gate reads a provider outage as "this devotional is fine".
 *
 * Fake timers rather than sleeping the real 2s retry delay, which is what the
 * sibling critic suites do and what makes them slow.
 */

const REPORT = {
  coherent: false,
  issues: [
    {
      severity: "high" as const,
      area: "scripture" as const,
      problem: "the reflection never touches the verse",
      suggestion: "anchor the second paragraph in Luke 8:25",
    },
  ],
  summary: "the verse and the reflection are about different things",
  suggestedScriptureReference: "Luke 8:24",
}

function input(llm: DevotionalLlm) {
  return {
    sceneTitle: "Jesus Calms the Storm",
    scriptureReference: "Luke 8:25",
    scriptureText: "Where is your faith?",
    title: "Peace in the Storm",
    reflection: "A reflection.",
    conclusion: "A closing line.",
    question: "A question?",
    prayer: "A prayer.",
    llm,
  }
}

function fakeLlm(complete: DevotionalLlm["complete"]): DevotionalLlm {
  return { model: "fake", complete }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("checkDevotionalCoherence", () => {
  it("passes the critic's verdict through, including the better-fitting verse", async () => {
    const complete = vi.fn().mockResolvedValue(REPORT)
    const r = await checkDevotionalCoherence(
      input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
    )
    expect(r.coherent).toBe(false)
    expect(r.issues).toHaveLength(1)
    expect(r.summary).toContain("different things")
    // The gate surfaces this as the one piece of advice naming WHAT to change,
    // and it used to be computed and dropped. Losing it here loses it there.
    expect(r.suggestedScriptureReference).toBe("Luke 8:24")
    expect(r.skipped).toBeFalsy()
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("retries once and returns the second attempt's verdict, unskipped", async () => {
    vi.useFakeTimers()
    const complete = vi
      .fn()
      .mockRejectedValueOnce(
        new DevotionalLlmError("request_failed", "transient"),
      )
      .mockResolvedValue({ ...REPORT, coherent: true, issues: [] })
    const pending = checkDevotionalCoherence(
      input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
    )
    await vi.advanceTimersByTimeAsync(2_000)
    const r = await pending
    expect(complete).toHaveBeenCalledTimes(2)
    expect(r.coherent).toBe(true)
    // A recovered call is a REAL verdict, so it must not be marked skipped —
    // otherwise the gate blocks every devotional that had one flaky attempt.
    expect(r.skipped).toBeFalsy()
  })

  it("marks the report skipped when both attempts fail, and says which code", async () => {
    vi.useFakeTimers()
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "down"))
    const pending = checkDevotionalCoherence(
      input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
    )
    await vi.advanceTimersByTimeAsync(2_000)
    const r = await pending
    expect(complete).toHaveBeenCalledTimes(2)
    // THE load-bearing pair. `coherent: true` keeps a checker outage from
    // blocking a render, and `skipped` is what stops the gate reading that
    // fail-open as a pass. Asserting them together is the point: either one
    // alone would pass with the other deleted.
    expect(r.coherent).toBe(true)
    expect(r.skipped).toBe(true)
    expect(r.summary).toContain("request_failed")
    expect(r.issues).toEqual([])
    expect(r.suggestedScriptureReference).toBeNull()
  })

  it("rethrows a non-LLM error instead of degrading to skipped", async () => {
    // A bug in our own code must not be laundered into "the check did not run",
    // which the gate turns into a block with a misleading reason.
    const boom = new TypeError("cannot read properties of undefined")
    const complete = vi.fn().mockRejectedValue(boom)
    await expect(
      checkDevotionalCoherence(
        input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
      ),
    ).rejects.toThrow(boom)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("rethrows a non-LLM error raised on the RETRY", async () => {
    vi.useFakeTimers()
    const boom = new TypeError("second attempt exploded")
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new DevotionalLlmError("request_failed", "first"))
      .mockRejectedValue(boom)
    const pending = checkDevotionalCoherence(
      input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
    )
    // Attach the rejection handler BEFORE advancing timers. Advancing first lets
    // the retry reject while nothing is listening, and vitest reports that as an
    // unhandled rejection — every test still green, whole run exit code 1.
    const rejects = expect(pending).rejects.toThrow(boom)
    await vi.advanceTimersByTimeAsync(2_000)
    await rejects
    expect(complete).toHaveBeenCalledTimes(2)
  })
})
