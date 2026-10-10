import { describe, expect, it } from "vitest"

import { PROMPT_SECTION_IDS } from "./prompt-sections"
import {
  criteriaFor,
  GLOBAL_CRITERIA,
  QUESTION_SET_ID,
  QUESTIONS,
  questionById,
} from "./questions"

describe("question corpus", () => {
  it("has ten questions under the new set id", () => {
    expect(QUESTIONS).toHaveLength(10)
    expect(QUESTION_SET_ID).toBe("seeker-eval/v1")
  })

  it("keeps question ids and criterion ids globally unique", () => {
    const questionIds = QUESTIONS.map((question) => question.id)
    expect(new Set(questionIds).size).toBe(questionIds.length)

    const criterionIds = [
      ...QUESTIONS.flatMap((question) =>
        question.criteria.map((criterion) => criterion.id),
      ),
      ...GLOBAL_CRITERIA.map((criterion) => criterion.id),
    ]
    expect(new Set(criterionIds).size).toBe(criterionIds.length)
  })

  it("tags EVERY criterion with at least one known prompt section", () => {
    for (const question of QUESTIONS) {
      for (const criterion of criteriaFor(question)) {
        expect(
          criterion.promptSections.length,
          `${criterion.id} has no promptSections tag`,
        ).toBeGreaterThan(0)
        for (const section of criterion.promptSections) {
          expect(PROMPT_SECTION_IDS).toContain(section)
        }
      }
    }
  })

  it("names a target section on every question", () => {
    for (const question of QUESTIONS) {
      expect(
        question.targets.length,
        `${question.id} names no target section`,
      ).toBeGreaterThan(0)
      for (const section of question.targets) {
        expect(PROMPT_SECTION_IDS).toContain(section)
      }
    }
  })

  it("pins the four extension questions to the sections they were built to probe", () => {
    expect(questionById("q-verse-exact-words").targets).toEqual([
      "citation-discipline",
      "safety",
    ])
    expect(questionById("q-links-to-verify").targets).toEqual([
      "citation-discipline",
    ])
    expect(questionById("q-bible-changed").targets).toEqual(["tool-usage"])
    expect(questionById("q-theotokos").targets).toEqual([
      "empty-unavailable-handling",
    ])
  })

  it("moved the mechanical criteria out of the judge lane", () => {
    // g-length and g-prose drove 9–10 false judge protocol errors per run;
    // they are code checks now (checks.ts) and must never return as judge
    // criteria.
    const ids = new Set(
      QUESTIONS.flatMap((question) =>
        criteriaFor(question).map((criterion) => criterion.id),
      ),
    )
    expect(ids.has("g-length")).toBe(false)
    expect(ids.has("g-prose")).toBe(false)
  })

  it("appends the global criteria to every question's own", () => {
    const question = questionById("q-suffering")
    const ids = criteriaFor(question).map((criterion) => criterion.id)
    expect(ids).toContain("g-on-topic")
    expect(ids).toContain("g-no-invented-citation")
    expect(ids.indexOf("g-on-topic")).toBeGreaterThan(
      ids.indexOf("q-suffering-serious"),
    )
  })

  it("throws on an unknown question id", () => {
    expect(() => questionById("q-nope")).toThrow(/unknown question id/)
  })
})
