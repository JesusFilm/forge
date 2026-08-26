import { describe, expect, it } from "vitest"

import {
  comparisonEvidenceWarnings,
  presentAggregateMetrics,
  presentProviderEvidence,
} from "./subtitle-lab-operator-presenter"

describe("subtitle Lab operator evidence presenter", () => {
  it("keeps malformed and oversized aggregate evidence bounded", () => {
    const rows = presentAggregateMetrics([
      {
        key: "es",
        sampleCount: 4,
        metrics: [
          { metric: "timing.meanIoU", mean: 0.81234 },
          { metric: "text.chrf", mean: Number.NaN },
        ],
      },
      { key: "ignored", sampleCount: -1, metrics: [] },
    ])

    expect(rows).toEqual([
      {
        key: "es",
        sampleCount: 4,
        metrics: [{ label: "timing.mean IoU", value: "0.812" }],
      },
    ])
  })

  it("surfaces provider call identities without provider response bodies", () => {
    const evidence = presentProviderEvidence({
      requestedProvider: "openrouter",
      requestedModel: "google/gemini-2.5-flash",
      cells: [
        {
          caseId: "jesus-film-1",
          targetLanguageId: "language-es",
          resolvedModel: "google/gemini-2.5-flash-2026-08",
          calls: [
            {
              leaseGeneration: 1,
              callSequence: 2,
              operation: "TRANSLATION",
              operationAttempt: 1,
              status: "SUCCEEDED",
              requestDigest: "a".repeat(64),
              providerRequestId: "req_123",
              providerResponseId: "resp_123",
              requestedModel: "google/gemini-2.5-flash",
              resolvedModel: "google/gemini-2.5-flash-2026-08",
              responseBody: "must never render",
            },
          ],
        },
      ],
    })

    expect(evidence.requestedProvider).toBe("openrouter")
    expect(evidence.calls).toHaveLength(1)
    expect(evidence.calls[0]).toMatchObject({
      caseId: "jesus-film-1",
      operation: "TRANSLATION",
      providerRequestId: "req_123",
      providerResponseId: "resp_123",
    })
    expect(JSON.stringify(evidence)).not.toContain("must never render")
  })

  it("labels unmatched and underpowered comparisons as descriptive", () => {
    expect(
      comparisonEvidenceWarnings({
        coverageLabel: "INSUFFICIENT_EVIDENCE",
        matchedCellCount: 4,
        matchedCollectionCount: 2,
        unmatchedCells: [{ caseId: "short-1" }],
        identityDifferences: [{ field: "model" }],
      }),
    ).toEqual([
      "Insufficient evidence: fewer than 5 matched cells or 3 collections.",
      "1 unmatched cell is excluded from every aggregate delta.",
      "Other run identities differ; this pair cannot isolate the declared axis.",
      "Deltas are descriptive and do not establish causality or generalize beyond this corpus.",
    ])
  })
})
