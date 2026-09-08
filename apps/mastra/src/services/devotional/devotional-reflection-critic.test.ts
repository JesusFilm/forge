import { describe, expect, it, vi } from "vitest"

import { _internal, critiqueReflection } from "./devotional-reflection-critic"
import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * This critic is the one that silently never ran. Its JSON schema carried
 * `minimum`/`maximum` on the integer `depthScore`, which Anthropic's
 * structured-output backend rejects with a 400 on EVERY call — while the
 * fail-open fallback printed "3/5 solid" and made the logs look healthy. It
 * then shipped with no tests of its own.
 *
 * `anthropic-schema-compat.test.ts` guards the schema keywords. These tests
 * guard the behaviour that hid the failure: the clamp, and the skip flag.
 */

function fakeLlm(complete: DevotionalLlm["complete"]): DevotionalLlm {
  return { model: "fake", complete }
}

const clean = {
  solid: true,
  depthScore: 4,
  issues: [],
  summary: "one grounded idea",
}

describe("critiqueReflection", () => {
  it("returns the critic's verdict and issues", async () => {
    const complete = vi.fn().mockResolvedValue({
      solid: false,
      depthScore: 2,
      issues: [
        {
          kind: "tautology",
          severity: "high",
          problem: "when he feeds you, he fills you",
          suggestion: "make a claim the viewer could disagree with",
        },
      ],
      summary: "restates itself",
    })
    const r = await critiqueReflection({
      sceneTitle: "Jesus Feeds 5,000",
      reflection: "When he feeds you, he fills you.",
      conclusion: "He fills.",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(r.solid).toBe(false)
    expect(r.depthScore).toBe(2)
    expect(r.issues[0].kind).toBe("tautology")
    expect(r.skipped).toBeFalsy()
  })

  it("passes the clip's real transcript to the model when given", async () => {
    const complete = vi.fn().mockResolvedValue(clean)
    await critiqueReflection({
      sceneTitle: "Pharisee and Tax Collector",
      reflection: "A humble heart welcomes God's grace.",
      conclusion: "Humility, not performance.",
      clipTranscript:
        "Once there were two men who went up to the temple to pray.",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    const user = complete.mock.calls[0][0].user
    expect(user).toContain(
      "Once there were two men who went up to the temple to pray.",
    )
    expect(user).toMatch(/judge retells-scene against this exact text/i)
  })

  it("omits the transcript block entirely when clipTranscript isn't given, leaving the prompt unchanged", async () => {
    const complete = vi.fn().mockResolvedValue(clean)
    await critiqueReflection({
      sceneTitle: "Jesus Feeds 5,000",
      reflection: "When he feeds you, he fills you.",
      conclusion: "He fills.",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    const user = complete.mock.calls[0][0].user
    expect(user).toBe(
      [
        "SCENE: Jesus Feeds 5,000",
        "",
        "REFLECTION:\nWhen he feeds you, he fills you.",
        "",
        "CLOSING TAKEAWAY: He fills.",
      ].join("\n"),
    )
  })

  it("treats an empty-string transcript the same as no transcript", async () => {
    const complete = vi.fn().mockResolvedValue(clean)
    await critiqueReflection({
      sceneTitle: "Jesus Feeds 5,000",
      reflection: "When he feeds you, he fills you.",
      conclusion: "He fills.",
      clipTranscript: "",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete.mock.calls[0][0].user).not.toMatch(/clip's own audio says/i)
  })

  describe("depthScore is CLAMPED, not rejected", () => {
    // Asserted against the ZOD SCHEMA, which is where the clamp actually runs —
    // `llm.complete()` parses the model's reply through it. Driving these cases
    // through a faked `complete` proves nothing, because the fake returns the
    // object verbatim and never applies the schema at all. (My first attempt did
    // exactly that and passed for the wrong reason.)
    //
    // Why clamp rather than reject: the 1-5 bound cannot live in the JSON schema
    // (Anthropic 400s on integer minimum/maximum), so the model is told the
    // range in the prompt and can still answer outside it. A strict zod bound
    // turned a scale misread into a `validation` error, which retry-then-skip
    // swallowed — losing a real critique over a formatting slip.
    const parse = (depthScore: number) =>
      _internal.Schema.parse({ ...clean, depthScore }).depthScore

    it("pulls an over-range score down into range", () => {
      expect(parse(8)).toBe(5)
    })

    it("pulls an under-range score up into range", () => {
      expect(parse(0)).toBe(1)
      expect(parse(-3)).toBe(1)
    })

    it("leaves in-range scores untouched", () => {
      expect(parse(1)).toBe(1)
      expect(parse(3)).toBe(3)
      expect(parse(5)).toBe(5)
    })

    it("still rejects a non-integer score outright", () => {
      // Clamping is for a misread SCALE, not for junk — a fractional or
      // non-numeric score means the reply is malformed, which should surface.
      expect(() => parse(2.5)).toThrow()
    })
  })

  it("retries once before giving up", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new DevotionalLlmError("request_failed", "boom"))
      .mockResolvedValueOnce(clean)
    const r = await critiqueReflection({
      sceneTitle: "scene",
      reflection: "text",
      conclusion: "c",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete).toHaveBeenCalledTimes(2)
    expect(r.skipped).toBeFalsy()
    expect(r.depthScore).toBe(4)
  })

  it("marks skipped after the retry also fails — the flag the gate reads", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(new DevotionalLlmError("request_failed", "boom"))
    const r = await critiqueReflection({
      sceneTitle: "scene",
      reflection: "text",
      conclusion: "c",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(complete).toHaveBeenCalledTimes(2)
    // `solid: true` / `depthScore: 3` are FALLBACKS, not a judgment. Only
    // `skipped` distinguishes them from a real pass, and
    // devotional-quality-gate.ts blocks on exactly this flag. Asserting the
    // fallback values without asserting `skipped` is what let the silent
    // failure survive for a day.
    expect(r.skipped).toBe(true)
    expect(r.solid).toBe(true)
    expect(r.depthScore).toBe(3)
    expect(r.summary).toMatch(/skipped/i)
  })

  it("rethrows a non-LLM error instead of reporting it as a skip", async () => {
    const complete = vi.fn().mockRejectedValue(new TypeError("programmer bug"))
    await expect(
      critiqueReflection({
        sceneTitle: "scene",
        reflection: "text",
        conclusion: "c",
        llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
      }),
    ).rejects.toThrow(TypeError)
  })

  it("parses a retells-scene verdict, the kind the owner rejects on", async () => {
    // The rule lives in the prompt, but a kind missing from the zod enum would
    // make every such verdict a parse error instead of a rejection — which is
    // how the whole check would go quietly dead.
    const complete = vi.fn().mockResolvedValue({
      solid: false,
      depthScore: 2,
      issues: [
        {
          kind: "retells-scene",
          severity: "high",
          problem: "most sentences only report what the viewer just watched",
          suggestion: "say something about the events instead of listing them",
        },
      ],
      summary: "narration, not a point",
    })
    const out = await critiqueReflection({
      sceneTitle: "scene",
      reflection: "text",
      conclusion: "c",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    })
    expect(out.solid).toBe(false)
    expect(out.depthScore).toBe(2)
    expect(out.issues[0].kind).toBe("retells-scene")
  })

  it("keeps the no-retelling budget in the prompt", () => {
    // Without a stated threshold this degraded into taste, and the writer's own
    // prompt used to license unlimited retelling after the opening.
    const complete = vi.fn().mockResolvedValue(clean)
    return critiqueReflection({
      sceneTitle: "scene",
      reflection: "text",
      conclusion: "c",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    }).then(() => {
      const system = complete.mock.calls[0][0].system as string
      expect(system).toMatch(/retells-scene/)
      expect(system).toMatch(/half or more/)
    })
  })

  it("states the 1-5 range in the prompt, since the schema cannot enforce it", () => {
    const complete = vi.fn().mockResolvedValue(clean)
    return critiqueReflection({
      sceneTitle: "scene",
      reflection: "text",
      conclusion: "c",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    }).then(() => {
      expect(complete.mock.calls[0][0].system).toMatch(/1 to 5|1-5/)
    })
  })

  it("keeps the predestination guardrail's both-sides calibration in the prompt", () => {
    // The guardrail misfired once on unasked grace toward ONE person, which is
    // the plain sense of these passages. Both the violation and the
    // NOT-a-violation side must stay stated, or it drifts back.
    const schemaless = _internal.JSON_SCHEMA
    expect(schemaless).toBeTruthy()
    const complete = vi.fn().mockResolvedValue(clean)
    return critiqueReflection({
      sceneTitle: "scene",
      reflection: "text",
      conclusion: "c",
      llm: fakeLlm(complete as unknown as DevotionalLlm["complete"]),
    }).then(() => {
      const system = complete.mock.calls[0][0].system as string
      expect(system).toMatch(/VIOLATION/)
      expect(system).toMatch(/NOT a violation/i)
    })
  })
})
