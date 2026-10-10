import { describe, expect, it } from "vitest"

import {
  goldenCasesRevision,
  resolveAttemptOutputDirectory,
  selectedCases,
} from "../scripts/eval.js"
import { GoldenFileSchema } from "../scripts/lib/evaluation/metrics.js"

const appendedIds = [
  "gq-seeker-abuse-safety",
  "gq-seeker-suicide",
  "gq-skeptic-evolution",
  "gq-skeptic-bible-slavery",
  "gq-believer-predestination",
  "gq-believer-church-hurt",
  "gq-believer-spiritual-warfare",
  "gq-newcomer-denominations",
  "gq-seeker-lgbt",
]

const cases = [
  ...Array.from({ length: 416 }, (_, index) => ({ id: `control-${index}` })),
  ...appendedIds.map((id) => ({ id })),
]

describe("golden case selection", () => {
  it("selects every current case and the immutable control prefix", () => {
    expect(selectedCases(cases, "current")).toHaveLength(425)
    expect(selectedCases(cases, "control-2026-08-06")).toEqual(
      cases.slice(0, 416),
    )
  })

  it("keeps the retained control stable when later cases are appended", () => {
    const extended = [...cases, { id: "later-case" }]
    const selected = selectedCases(extended, "control-2026-08-06")
    expect(selected).toEqual(cases.slice(0, 416))
    expect(goldenCasesRevision(selected)).toBe(
      goldenCasesRevision(selectedCases(cases, "control-2026-08-06")),
    )
  })

  it("rejects changes to the pinned post-control reconciliation IDs", () => {
    const changed = cases.map((item) => ({ ...item }))
    changed[424].id = "changed"
    expect(() => selectedCases(changed, "control-2026-08-06")).toThrow(
      /nine post-control cases changed/,
    )
  })

  it("rejects duplicate case IDs at schema validation before selection", () => {
    const goldenCase = {
      id: "duplicate",
      question: "question",
      language: "en",
      relevant: { source: ["/answer"] },
    }
    expect(() =>
      GoldenFileSchema.parse({ cases: [goldenCase, goldenCase] }),
    ).toThrow(/duplicate golden case id/)
  })
})

describe("evaluation attempt output", () => {
  const packageDirectory = "/workspace/apps/rag"

  it("allows the attempts root and its descendants", () => {
    expect(
      resolveAttemptOutputDirectory(packageDirectory, "eval/attempts"),
    ).toBe("/workspace/apps/rag/eval/attempts")
    expect(
      resolveAttemptOutputDirectory(packageDirectory, "eval/attempts/retry"),
    ).toBe("/workspace/apps/rag/eval/attempts/retry")
  })

  it.each(["/tmp/eval", "eval/results", "eval/attempts/../../outside"])(
    "rejects output outside the attempts tree: %s",
    (requested) => {
      expect(() =>
        resolveAttemptOutputDirectory(packageDirectory, requested),
      ).toThrow(/evaluation refused/)
    },
  )
})
