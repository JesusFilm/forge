import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SubtitleRunComparison } from "./subtitle-run-comparison"
import type { SubtitleLabComparison } from "./subtitle-lab-operator-types"

const comparison: SubtitleLabComparison = {
  id: "comparison-1",
  baselineReportId: "report-baseline",
  candidateReportId: "report-candidate",
  changedAxis: "PROMPT_POLICY",
  coverageLabel: "INSUFFICIENT_EVIDENCE",
  matchedCellCount: 4,
  matchedCollectionCount: 2,
  descriptiveDeltas: [
    {
      scope: "language",
      key: "language-es",
      sampleCount: 4,
      metrics: [{ metric: "timing.meanIoU", meanDelta: 0.04 }],
    },
  ],
  humanEvidence: {
    reviewedPairCount: 1,
    pendingPairCount: 1,
    unmatchedPairCount: 0,
    byLanguage: [
      {
        key: "language-es",
        reviewedPairCount: 1,
        verdictChangeCount: 1,
        scoreDeltas: [
          {
            metric: "meaningAccuracyScore",
            sampleCount: 1,
            meanDelta: 1,
          },
        ],
      },
    ],
    byCollection: [],
    cells: [
      {
        key: "case-1:language-es",
        status: "REVIEWED",
        baseline: { verdictCounts: { NEEDS_CHANGES: 1 } },
        candidate: { verdictCounts: { PASS: 1 } },
      },
    ],
  },
  identityDifferences: [
    { field: "codeRevision", baseline: "a", candidate: "b" },
  ],
  unmatchedCells: [{ side: "candidate", caseId: "short-1" }],
  narratives: [
    {
      id: "narrative-1",
      version: 1,
      hypothesis: "The prompt reduces omissions.",
      conclusion: "Timing improved; meaning needs more review.",
      rationale: "Four matched cells are not enough for promotion.",
      followUpAction: "Run a larger approved corpus.",
      createdById: "operator-1",
      createdAt: "2026-08-20T12:00:00.000Z",
    },
  ],
}

describe("SubtitleRunComparison", () => {
  it("shows matched-only descriptive deltas and append-only experiment learning", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleRunComparison, { comparison }),
    )

    expect(markup).toContain("Declared changed axis")
    expect(markup).toContain("PROMPT POLICY")
    expect(markup).toContain("Insufficient evidence")
    expect(markup).toContain("1 unmatched cell is excluded")
    expect(markup).toContain("Other run identities differ")
    expect(markup).toContain("do not establish causality")
    expect(markup).toContain("language-es")
    expect(markup).toContain("Human validation evidence")
    expect(markup).toContain("NEEDS CHANGES: 1")
    expect(markup).toContain("PASS: 1")
    expect(markup).toContain("The prompt reduces omissions")
    expect(markup).toContain("Append experiment narrative")
    expect(markup).not.toMatch(/>\s*(Publish|Activate prompt|Deploy)\s*</i)
  })
})
