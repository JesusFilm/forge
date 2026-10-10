import { describe, expect, it } from "vitest"

import { criteriaHash, sha256, weightsHash } from "./hashes"
import type { Criterion, Question } from "./questions"
import type { CriterionClass } from "./weights"

/**
 * criteriaHash is the ONLY guard identityMismatch's criteria dimension has
 * (finding #2): a bug that dropped polarity — or any other field — from the
 * hash material would let a must → must-not rubric flip compare as "the same
 * measurement". These are unit tests of the MACHINE, so the fixtures are
 * small inline questions, never the real questions.ts corpus. (criteriaHash
 * appends the GLOBAL_CRITERIA via criteriaFor — constant across cases here,
 * so every difference below is attributable to the edited field.)
 */
function makeCriterion(overrides: Partial<Criterion> = {}): Criterion {
  return {
    id: "c-plain",
    polarity: "must",
    text: "Explains the point plainly.",
    promptSections: ["persona"],
    ...overrides,
  }
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-test",
    category: "doctrine",
    text: "What is grace?",
    targets: ["persona"],
    criteria: [makeCriterion()],
    ...overrides,
  }
}

describe("criteriaHash — the rubric-edit tripwire", () => {
  it("is deterministic for identical input", () => {
    expect(criteriaHash([makeQuestion()])).toBe(criteriaHash([makeQuestion()]))
    expect(criteriaHash([makeQuestion()])).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes when a criterion's TEXT changes", () => {
    const edited = makeQuestion({
      criteria: [makeCriterion({ text: "Explains the point warmly." })],
    })
    expect(criteriaHash([edited])).not.toBe(criteriaHash([makeQuestion()]))
  })

  it("changes when a criterion's POLARITY flips — a must → must-not flip is a different rubric", () => {
    const flipped = makeQuestion({
      criteria: [makeCriterion({ polarity: "must-not" })],
    })
    expect(criteriaHash([flipped])).not.toBe(criteriaHash([makeQuestion()]))
  })

  it("changes when a criterion's promptSections tags change — re-tagging moves report attribution", () => {
    const retagged = makeQuestion({
      criteria: [makeCriterion({ promptSections: ["safety"] })],
    })
    expect(criteriaHash([retagged])).not.toBe(criteriaHash([makeQuestion()]))
  })

  it("changes when a criterion is added or removed", () => {
    const grown = makeQuestion({
      criteria: [makeCriterion(), makeCriterion({ id: "c-second" })],
    })
    expect(criteriaHash([grown])).not.toBe(criteriaHash([makeQuestion()]))
  })

  it("changes when a question is added or removed", () => {
    const two = [makeQuestion(), makeQuestion({ id: "q-other" })]
    expect(criteriaHash(two)).not.toBe(criteriaHash([makeQuestion()]))
  })
})

describe("weightsHash — the reclassification tripwire (finding #10)", () => {
  const CLASSES: Readonly<Record<string, CriterionClass>> = {
    "c-cite": "grounding",
    "c-warm": "tone",
  }
  const WEIGHTS: Readonly<Record<string, number>> = {
    grounding: 5,
    doctrine: 2,
    tone: 1,
  }

  it("is deterministic — for the injected material AND the production default", () => {
    expect(weightsHash({ classes: CLASSES, weights: WEIGHTS })).toBe(
      weightsHash({ classes: CLASSES, weights: WEIGHTS }),
    )
    expect(weightsHash()).toBe(weightsHash())
    expect(weightsHash()).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes when the version bumps", () => {
    expect(
      weightsHash({ version: "seeker-weights/v2", classes: CLASSES }),
    ).not.toBe(weightsHash({ version: "seeker-weights/v1", classes: CLASSES }))
  })

  it("changes when a criterion is reclassified — the same-PR grounding → tone demotion", () => {
    const demoted: Readonly<Record<string, CriterionClass>> = {
      ...CLASSES,
      "c-cite": "tone",
    }
    expect(weightsHash({ classes: demoted, weights: WEIGHTS })).not.toBe(
      weightsHash({ classes: CLASSES, weights: WEIGHTS }),
    )
  })

  it("changes when a class weight changes", () => {
    expect(
      weightsHash({ classes: CLASSES, weights: { ...WEIGHTS, grounding: 4 } }),
    ).not.toBe(weightsHash({ classes: CLASSES, weights: WEIGHTS }))
  })

  it("does NOT change on object-literal key order — entries are key-sorted", () => {
    const reordered: Readonly<Record<string, CriterionClass>> = {
      "c-warm": "tone",
      "c-cite": "grounding",
    }
    expect(weightsHash({ classes: reordered, weights: WEIGHTS })).toBe(
      weightsHash({ classes: CLASSES, weights: WEIGHTS }),
    )
  })
})

describe("sha256", () => {
  it("hashes deterministically and is input-sensitive", () => {
    expect(sha256("a")).toBe(sha256("a"))
    expect(sha256("a")).not.toBe(sha256("b"))
    expect(sha256("a")).toMatch(/^[0-9a-f]{64}$/)
  })
})
