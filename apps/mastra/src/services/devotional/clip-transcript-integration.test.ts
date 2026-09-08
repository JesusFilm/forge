import { describe, expect, it, vi } from "vitest"

/**
 * U6 of docs/plans/2026-09-09-001-feat-clip-subtitle-transcript-in-reflection-pipeline-plan.md
 *
 * Every unit that touches `clipTranscript` (generation, the writer, the
 * depth critic, the quality gate) has its own fallback test proving IT
 * behaves the same with no transcript. This test proves the CHAIN does: a
 * subtitle fetch that fails at generation time still produces a
 * `GeneratedDevotional` that flows cleanly through `reviewDevotionalText`
 * with no blocking issues — the same result the pipeline produced before
 * this feature existed. Catches a wiring mismatch (wrong field name, a
 * transcript silently reaching one consumer but not another) that each
 * unit's own isolated test cannot see.
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

const { generateDevotional } = await import("./generate-devotional")
const { reviewDevotionalText } = await import("./devotional-quality-gate")

describe("clip transcript — end-to-end fallback parity", () => {
  it("a failing subtitle fetch still produces a devotional that passes the gate clean, with no clipTranscript anywhere", async () => {
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

    const llm = { model: "fake", complete: vi.fn() }
    const corpora: import("./reflection-corpus").ReflectionCorpora = {
      ryleMatthew: [],
      ryleLuke: [
        {
          source: "J.C. Ryle, Expository Thoughts on the Gospels: Luke",
          reference: "Jesus Calms the Storm, Luke 8:22-25",
          osisRef: "Luke.8.22-Luke.8.25",
          text: "Ryle on Luke 8 (the storm).",
        },
      ],
      matthewHenry: [],
      spurgeon: [],
    }

    const d = await generateDevotional(
      { chapterIndex: 19, sequence: 0, date: "2026-09-09", llm },
      {
        corpora,
        selectScripture: vi.fn().mockResolvedValue({
          reference: "Luke 8:25",
          text: "Where is your faith?",
          translation: "WEB",
          needsCanonicalSource: true,
        }),
        // The failure mode this test exists for: the transcript fetch itself
        // rejects, exactly as it would on a real network failure.
        fetchTranscript: vi.fn().mockRejectedValue(new Error("network down")),
        modernize: vi.fn().mockResolvedValue({
          adapted: "Modernized reflection text about trusting God.",
          attribution: "Adapted from a trusted classic · Ryle",
          focusReference: "Luke 8:22-25",
        }),
        writeCopy: vi.fn().mockResolvedValue({
          title: "Peace in the Storm",
          question: "What storm do you need to hand to Jesus today?",
          prayer: "Jesus, help me trust you.",
        }),
        writeConclusion: vi.fn().mockResolvedValue({
          conclusion: "The One who calms the sea is in your boat.",
        }),
        pickHighlights: vi.fn().mockResolvedValue([]),
      },
    )

    expect(d.clipTranscript).toBeUndefined()

    const review = await reviewDevotionalText({
      devotional: d,
      checkFidelity: true,
    })
    expect(review.blocking).toEqual([])

    // The depth critic — the one consumer with a documented retells-scene
    // rule that depends on this field — received no clipTranscript, proving
    // the failure at generation time never silently reached it as something
    // else (e.g. an empty string it would have treated as real content).
    const depthCall = critiqueReflection.mock.calls.at(-1)?.[0]
    expect(depthCall).not.toHaveProperty("clipTranscript")
  })
})
