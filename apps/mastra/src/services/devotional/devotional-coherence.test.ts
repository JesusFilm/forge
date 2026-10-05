import { describe, expect, it, vi } from "vitest"

import { checkDevotionalCoherence } from "./devotional-coherence"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * This critic shipped with no tests, and it is the one the quality gate consults
 * FIRST: the gate blocks on `skipped` before it looks at `coherent`. That makes
 * the fail-open shape load-bearing — on a provider failure the critic returns
 * `coherent: true` so a checker outage never blocks a render, and `skipped: true`
 * is the ONLY thing distinguishing that from a genuine pass. Delete the flag and
 * the gate reads a provider outage as "this devotional is fine".
 *
 * ONE attempt per critic. `createDevotionalLlm` owns the retry budget (429/5xx up
 * to three attempts, honouring Retry-After), so a retry here would double a
 * budget already spent — which is how three critics reached a worst case of
 * eighteen requests for one gate. Nothing to fake, no second call to assert.
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

function failing(error: Error) {
  return vi.fn().mockRejectedValue(error)
}

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

  it("degrades on the FIRST provider failure, with no second attempt", async () => {
    const complete = failing(
      new DevotionalLlmError("request_failed", "down", undefined, 503),
    )
    const r = await checkDevotionalCoherence(
      input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
    )
    expect(complete).toHaveBeenCalledTimes(1)
    // THE load-bearing pair, asserted together on purpose: either one alone still
    // passes with the other deleted. `coherent: true` keeps a checker outage from
    // blocking a render; `skipped` stops the gate reading that fail-open as a pass.
    expect(r.coherent).toBe(true)
    expect(r.skipped).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.suggestedScriptureReference).toBeNull()
  })

  it.each([
    { code: "transport" as const, status: undefined, shown: "transport" },
    { code: "request_failed" as const, status: 400, shown: "400" },
    { code: "validation" as const, status: undefined, shown: "validation" },
    {
      code: "missing_credentials" as const,
      status: undefined,
      shown: "missing_credentials",
    },
  ])(
    "degrades once on $code and names $shown in the summary",
    async ({ code, status, shown }) => {
      // Every failure code takes the same single-attempt path now. The status is
      // the one thing a caller cannot recover on its own, and it is what tells an
      // operator whether an outage was a 429, a 500, or a permanent 400.
      const complete = failing(
        new DevotionalLlmError(code, "nope", undefined, status),
      )
      const r = await checkDevotionalCoherence(
        input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
      )
      expect(complete).toHaveBeenCalledTimes(1)
      expect(r.skipped).toBe(true)
      expect(r.summary).toContain(shown)
    },
  )

  it("rethrows a cancellation instead of degrading to skipped", async () => {
    // The client reports a caller abort as DevotionalLlmError("transport"),
    // which is exactly what a real network fault looks like — and this critic
    // degrades that to a `skipped` verdict. Degrading a CANCELLATION produces
    // ordinary workflow data, so in report-only mode the run carried on as if
    // nothing had happened. The aborted signal is the only thing that separates
    // the two, and it has to be read here rather than upstream: the gate mocks
    // these critics out, so its own suite cannot see this branch.
    const controller = new AbortController()
    controller.abort()
    const complete = failing(
      new DevotionalLlmError("transport", "request cancelled by caller"),
    )
    await expect(
      checkDevotionalCoherence({
        ...input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
        abortSignal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(DevotionalLlmError)
  })

  it("still degrades the SAME error when nothing was cancelled", async () => {
    // The anti-vacuous half: identical error, no abort. If the critic simply
    // stopped degrading transport failures, the case above would pass for the
    // wrong reason.
    const complete = failing(
      new DevotionalLlmError("transport", "request cancelled by caller"),
    )
    const r = await checkDevotionalCoherence(
      input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
    )
    expect(r.skipped).toBe(true)
  })

  it("rethrows a non-LLM error instead of degrading to skipped", async () => {
    // A bug in our own code must not be laundered into "the check did not run",
    // which the gate turns into a block with a misleading reason.
    const boom = new TypeError("cannot read properties of undefined")
    const complete = failing(boom)
    await expect(
      checkDevotionalCoherence(
        input(fakeLlm(complete as unknown as DevotionalLlm["complete"])),
      ),
    ).rejects.toThrow(boom)
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
