import { beforeEach, describe, expect, it, vi } from "vitest"

import { DevotionalLlmError } from "./llm"

/**
 * The gate is the one place that decides whether text is allowed to cost money
 * (ElevenLabs narration) and minutes (Remotion render). It shipped with NO
 * tests, which is how two holes stayed open in it:
 *
 *  - a critic's own VERDICT (`coherent` / `solid` / `faithful`) was computed and
 *    never read, so a critic could say "this is not shippable" at medium
 *    severity and the gate passed it;
 *  - `checkFidelity: true` with no `sourceExcerpt` skipped the check silently,
 *    which is the same "we didn't check == it passed" confusion the gate exists
 *    to prevent.
 *
 * Every verdict case below is built so ONLY the verdict branch can match — no
 * high-severity issues in the fixture — otherwise the test would pass even if
 * the verdict check were deleted again.
 */

const checkDevotionalCoherence = vi.fn()
const critiqueReflection = vi.fn()
const critiqueReflectionFidelity = vi.fn()

vi.mock("./devotional-coherence", () => ({
  checkDevotionalCoherence: (...a: unknown[]) => checkDevotionalCoherence(...a),
}))
vi.mock("./devotional-reflection-critic", () => ({
  critiqueReflection: (...a: unknown[]) => critiqueReflection(...a),
}))
vi.mock("./reflection-fidelity-critic", () => ({
  critiqueReflectionFidelity: (...a: unknown[]) =>
    critiqueReflectionFidelity(...a),
}))
vi.mock("./devotional-models", () => ({
  buildCoherenceLlm: () => ({}),
  buildReflectionCriticLlm: () => ({}),
  buildFidelityCriticLlm: () => ({}),
}))

const { reviewDevotionalText } = await import("./devotional-quality-gate")

type Devo = Parameters<typeof reviewDevotionalText>[0]["devotional"]

function devotional(overrides: Record<string, unknown> = {}): Devo {
  return {
    date: "2026-08-12",
    clip: { index: 33, id: "1_jf6133-0-0", title: "Jesus and Zaccheus" },
    passage: { reference: "Luke 19:1-10", osisRef: "Luke.19.1-Luke.19.10" },
    title: "Jesus stopped for the man everyone despised.",
    scripture: {
      reference: "Luke 19:10",
      text: "For the Son of Man came to seek and to save that which was lost.",
      translation: "WEB",
      needsCanonicalSource: false,
    },
    reflection: {
      text: "Jesus came to seek and save the lost.",
      source: "J.C. Ryle",
      attribution: "Adapted from a trusted classic · J.C. Ryle",
      flavor: "commentary",
      sourceExcerpt: "Unasked, our Lord stops and speaks to Zacchaeus.",
    },
    reflectionHighlights: [],
    conclusion: "Grace that finds you will not leave you the same.",
    question: "Where has grace been received but not shown?",
    prayer: "Ask God to show you where grace asks for more than words.",
    mood: "hope",
    voice: "male-d",
    sequence: 0,
    ...overrides,
  } as Devo
}

/** A clean pass from every critic; individual tests override one at a time. */
function allClean() {
  checkDevotionalCoherence.mockResolvedValue({
    coherent: true,
    issues: [],
    summary: "coherent",
    suggestedScriptureReference: null,
  })
  critiqueReflection.mockResolvedValue({
    solid: true,
    depthScore: 4,
    issues: [],
    summary: "solid",
  })
  critiqueReflectionFidelity.mockResolvedValue({
    faithful: true,
    issues: [],
    summary: "faithful",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  allClean()
})

describe("reviewDevotionalText", () => {
  it("stops after the critic that was running when the caller cancelled", async () => {
    // The three run in SEQUENCE, so a cancelled run would otherwise keep paying
    // for the two that had not started. The signal is what the client checks
    // before each attempt and what cuts its backoff short.
    const controller = new AbortController()
    checkDevotionalCoherence.mockImplementation(async () => {
      controller.abort()
      return {
        coherent: true,
        issues: [],
        summary: "ok",
        suggestedScriptureReference: null,
      }
    })
    critiqueReflection.mockImplementation(
      async (args: { abortSignal?: AbortSignal }) => {
        // The REAL typed path. createDevotionalLlm reports a caller abort as
        // DevotionalLlmError("transport") — indistinguishable from a genuine
        // network fault, which each critic degrades to a `skipped` verdict. A
        // generic Error here would bypass that fallback entirely and prove the
        // opposite control flow. The aborted signal is the ONLY thing separating
        // the two, which is exactly what this asserts.
        if (args.abortSignal?.aborted) {
          throw new DevotionalLlmError(
            "transport",
            "request cancelled by caller",
          )
        }
        return { solid: true, depthScore: 4, issues: [], summary: "ok" }
      },
    )

    await expect(
      reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
        abortSignal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(DevotionalLlmError)

    // The third critic never started.
    expect(critiqueReflectionFidelity).not.toHaveBeenCalled()
  })

  it("passes the caller's signal to every critic", async () => {
    const controller = new AbortController()
    await reviewDevotionalText({
      devotional: devotional(),
      checkFidelity: true,
      abortSignal: controller.signal,
    })
    for (const critic of [
      checkDevotionalCoherence,
      critiqueReflection,
      critiqueReflectionFidelity,
    ]) {
      expect(critic).toHaveBeenCalledWith(
        expect.objectContaining({ abortSignal: controller.signal }),
      )
    }
  })

  it("passes clean text with nothing blocking", async () => {
    const r = await reviewDevotionalText({
      devotional: devotional(),
      checkFidelity: true,
    })
    expect(r.blocking).toEqual([])
  })

  describe("a check that could not RUN blocks", () => {
    it("blocks when coherence was skipped", async () => {
      // `coherent: true` here is the fallback value, NOT a verdict — exactly the
      // shape the critic returns after its retry fails.
      checkDevotionalCoherence.mockResolvedValue({
        coherent: true,
        issues: [],
        summary: "coherence check skipped after retry: request_failed",
        skipped: true,
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toContain("coherence check could not run")
    })

    it("blocks when the depth check was skipped", async () => {
      critiqueReflection.mockResolvedValue({
        solid: true,
        depthScore: 3,
        issues: [],
        summary: "reflection critique skipped after retry: request_failed",
        skipped: true,
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toContain("depth check could not run")
    })

    it("blocks when the fidelity check was skipped", async () => {
      critiqueReflectionFidelity.mockResolvedValue({
        faithful: true,
        issues: [],
        summary: "fidelity critique skipped after retry: request_failed",
        skipped: true,
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toContain("fidelity check could not run")
    })
  })

  describe("a critic's own verdict blocks, even with no high-severity issue", () => {
    it("blocks on coherent: false", async () => {
      checkDevotionalCoherence.mockResolvedValue({
        coherent: false,
        // Deliberately MEDIUM. If the gate only scanned severities, this case
        // would pass — which is the bug this test exists for.
        issues: [
          {
            severity: "medium",
            area: "scripture-fit",
            problem: "the verse does not carry the reflection's claim",
            suggestion: "choose a verse about seeking",
          },
        ],
        summary: "verse and reflection argue different things",
        suggestedScriptureReference: "Luke 19:10",
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toHaveLength(1)
      expect(r.blocking[0]).toMatch(/^coherence: /)
    })

    it("blocks on solid: false — this is how the depth critic reports its hard guardrail", async () => {
      // The depth prompt tells the critic to set `solid: false` for
      // denominational polemic or predestination teaching and to file it as an
      // `obvious` issue with NO severity requirement. A guardrail violation
      // reported at medium severity used to ship.
      critiqueReflection.mockResolvedValue({
        solid: false,
        depthScore: 4,
        issues: [
          {
            severity: "medium",
            kind: "obvious",
            problem: "teaches election: grace offered only to a closed group",
            suggestion: "keep to the passage's plain sense",
          },
        ],
        summary: "contains predestination teaching",
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toHaveLength(1)
      expect(r.blocking[0]).toMatch(/^depth 4\/5: /)
    })

    it("blocks a thin reflection the critic still called solid", async () => {
      critiqueReflection.mockResolvedValue({
        solid: true,
        depthScore: 2,
        issues: [],
        summary: "restates the verse and stops",
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toEqual(["depth 2/5: restates the verse and stops"])
    })

    it("does NOT block at the depth floor's safe side", async () => {
      critiqueReflection.mockResolvedValue({
        solid: true,
        depthScore: 3,
        issues: [],
        summary: "one clear idea",
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toEqual([])
    })

    it("blocks on faithful: false", async () => {
      critiqueReflectionFidelity.mockResolvedValue({
        faithful: false,
        issues: [
          {
            severity: "medium",
            kind: "invented-content",
            problem: "adds a detail the source never states",
            suggestion: "drop the invented clause",
          },
        ],
        summary: "adds content the author did not write",
      })
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: true,
      })
      expect(r.blocking).toHaveLength(1)
      expect(r.blocking[0]).toMatch(/^fidelity: /)
    })
  })

  it("still blocks on a high-severity issue when the verdict itself is positive", async () => {
    checkDevotionalCoherence.mockResolvedValue({
      coherent: true,
      issues: [
        {
          severity: "high",
          area: "grounding",
          problem: "the reflection contradicts the scene",
          suggestion: "rewrite against the passage",
        },
      ],
      summary: "coherent overall",
      suggestedScriptureReference: null,
    })
    const r = await reviewDevotionalText({
      devotional: devotional(),
      checkFidelity: true,
    })
    expect(r.blocking).toEqual(["coherence: high-severity issue"])
  })

  describe("fidelity checking is conditional", () => {
    it("warns but does NOT block when there is no source excerpt to check against", async () => {
      const devo = devotional({
        reflection: {
          text: "Jesus came to seek and save the lost.",
          source: "J.C. Ryle",
          attribution: "Adapted from a trusted classic · J.C. Ryle",
          flavor: "commentary",
          // No sourceExcerpt — the shape of a devotional read back from an
          // attempt artifact written before the field existed.
        },
      })
      const lines: string[] = []
      const r = await reviewDevotionalText({
        devotional: devo,
        checkFidelity: true,
        log: (m) => lines.push(m),
      })
      expect(critiqueReflectionFidelity).not.toHaveBeenCalled()
      // Deliberately NOT blocking: the excerpt cannot be reconstructed after
      // the fact, so blocking would make already-approved devotionals
      // permanently unrenderable. Distinct from a `skipped` critic, which DOES
      // block — that is a check that failed, not one with no input.
      expect(r.blocking).toEqual([])
      expect(lines.join("\n")).toMatch(/NOT CHECKED/)
    })

    it("judges fidelity against the SOURCE's passage, not the film's", async () => {
      // A Spurgeon selection is picked by theme, so its own reference can be a
      // different book entirely. Asking this critic whether an adaptation of
      // Isaiah is faithful to Luke is a question it cannot answer usefully, and
      // it was the question being asked.
      const devo = devotional({
        passage: { reference: "Luke 8:22-25", osisRef: "Luke.8.22-Luke.8.25" },
        reflection: {
          text: "Peace comes from a mind stayed on God.",
          source: "Charles Spurgeon, Morning and Evening",
          attribution: "Adapted from a trusted classic · Charles Spurgeon",
          flavor: "spurgeon",
          sourceReference: "Isaiah 26:3",
          sourceExcerpt: "You keep him in perfect peace whose mind is stayed.",
        },
      })
      await reviewDevotionalText({
        devotional: devo,
        checkFidelity: true,
        passageReference: "Luke 8:22-25",
      })
      expect(critiqueReflectionFidelity).toHaveBeenCalledWith(
        expect.objectContaining({ focusReference: "Isaiah 26:3" }),
      )
      // Coherence still gets the film's passage: it judges the finished
      // devotional against the verse on screen.
      expect(checkDevotionalCoherence).toHaveBeenCalledWith(
        expect.objectContaining({ passageReference: "Luke 8:22-25" }),
      )
    })

    it("falls back to the film passage when the source reference is absent", async () => {
      const devo = devotional({
        reflection: {
          text: "Jesus came to seek and save the lost.",
          source: "J.C. Ryle",
          attribution: "Adapted from a trusted classic · J.C. Ryle",
          flavor: "commentary",
          sourceExcerpt: "Unasked, our Lord stops and speaks to Zacchaeus.",
        },
      })
      await reviewDevotionalText({
        devotional: devo,
        checkFidelity: true,
        passageReference: "Luke 19:1-10",
      })
      expect(critiqueReflectionFidelity).toHaveBeenCalledWith(
        expect.objectContaining({ focusReference: "Luke 19:1-10" }),
      )
    })

    it("treats a BLANK excerpt as no excerpt rather than checking against nothing", async () => {
      // A whitespace-only excerpt is truthy, so the plain truthiness test handed
      // the critic a blank source. With nothing to compare against it reported
      // the adaptation faithful, and the gate recorded a PASS on a check that
      // never really happened — the one outcome this module exists to prevent.
      const devo = devotional({
        reflection: {
          text: "Jesus came to seek and save the lost.",
          source: "J.C. Ryle",
          attribution: "Adapted from a trusted classic · J.C. Ryle",
          flavor: "commentary",
          sourceExcerpt: "   \n  ",
        },
      })
      const lines: string[] = []
      const r = await reviewDevotionalText({
        devotional: devo,
        checkFidelity: true,
        log: (m) => lines.push(m),
      })
      expect(critiqueReflectionFidelity).not.toHaveBeenCalled()
      expect(r.blocking).toEqual([])
      expect(lines.join("\n")).toMatch(/NOT CHECKED/)
    })

    it("skips fidelity without blocking when it was not requested (localized run)", async () => {
      const r = await reviewDevotionalText({
        devotional: devotional(),
        checkFidelity: false,
      })
      expect(critiqueReflectionFidelity).not.toHaveBeenCalled()
      expect(r.blocking).toEqual([])
    })
  })

  it("accumulates every reason rather than stopping at the first", async () => {
    checkDevotionalCoherence.mockResolvedValue({
      coherent: true,
      issues: [],
      summary: "skipped",
      skipped: true,
    })
    critiqueReflection.mockResolvedValue({
      solid: false,
      depthScore: 1,
      issues: [],
      summary: "empty",
    })
    critiqueReflectionFidelity.mockResolvedValue({
      faithful: false,
      issues: [],
      summary: "invents content",
    })
    const r = await reviewDevotionalText({
      devotional: devotional(),
      checkFidelity: true,
    })
    expect(r.blocking).toHaveLength(3)
  })

  it("surfaces the critic's suggested replacement verse to the log", async () => {
    checkDevotionalCoherence.mockResolvedValue({
      coherent: true,
      issues: [],
      summary: "coherent",
      suggestedScriptureReference: "Luke 19:10",
    })
    const lines: string[] = []
    await reviewDevotionalText({
      devotional: devotional(),
      checkFidelity: true,
      log: (m) => lines.push(m),
    })
    // The suggestion was computed and dropped before; it is the one output that
    // tells an operator WHAT to change.
    expect(lines.join("\n")).toContain("Luke 19:10")
  })
})
