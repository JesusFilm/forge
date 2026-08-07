import { describe, expect, it } from "vitest"

import { criteriaFor, GLOBAL_CRITERIA, QUESTIONS } from "./questions"
import {
  CLASS_WEIGHTS,
  CRITERION_CLASSES,
  classFor,
  weightFor,
  WEIGHTS_VERSION,
} from "./weights"

/** The full criterion inventory: every per-question criterion + each global once. */
function inventory() {
  return [
    ...QUESTIONS.flatMap((question) => question.criteria),
    ...GLOBAL_CRITERIA,
  ]
}

describe("weights completeness", () => {
  it("classifies every judge criterion (no unweighted criterion can enter a score)", () => {
    for (const criterion of inventory()) {
      expect(
        CRITERION_CLASSES[criterion.id],
        `${criterion.id} is not classified in weights.ts — classify it and bump ${WEIGHTS_VERSION}`,
      ).toBeDefined()
    }
  })

  it("carries no stray entries for criteria that no longer exist", () => {
    const known = new Set(inventory().map((criterion) => criterion.id))
    for (const id of Object.keys(CRITERION_CLASSES)) {
      expect(
        known.has(id),
        `weights.ts classifies unknown criterion ${id}`,
      ).toBe(true)
    }
  })

  it("throws loudly for an unclassified criterion", () => {
    expect(() => classFor("q-not-a-criterion")).toThrow(/no class/)
    expect(() => weightFor("q-not-a-criterion")).toThrow(/no class/)
  })
})

describe("weights bar (maintainer-reviewed invariants)", () => {
  it("gives grounding criteria at least 60% of the INVENTORY weight", () => {
    let grounding = 0
    let total = 0
    for (const criterion of inventory()) {
      const weight = weightFor(criterion.id)
      total += weight
      if (classFor(criterion.id) === "grounding") grounding += weight
    }
    expect(grounding / total).toBeGreaterThanOrEqual(0.6)
  })

  it("gives grounding criteria at least 60% of the APPLIED weight a full run scores", () => {
    // Applied mass: the globals weigh in once per question, exactly as the
    // pooled run score consumes them.
    let grounding = 0
    let total = 0
    for (const question of QUESTIONS) {
      for (const criterion of criteriaFor(question)) {
        const weight = weightFor(criterion.id)
        total += weight
        if (classFor(criterion.id) === "grounding") grounding += weight
      }
    }
    expect(grounding / total).toBeGreaterThanOrEqual(0.6)
  })

  it("lets no single tone or doctrine criterion outweigh any grounding criterion", () => {
    expect(CLASS_WEIGHTS.tone).toBeLessThan(CLASS_WEIGHTS.grounding)
    expect(CLASS_WEIGHTS.doctrine).toBeLessThan(CLASS_WEIGHTS.grounding)
  })

  it("keeps all weights positive (a zero weight would silently delete a criterion)", () => {
    for (const weight of Object.values(CLASS_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0)
    }
  })
})
