import { describe, expect, it } from "vitest"

import { buildDailySummaryAction, buildSupportRunReport } from "./daily-report"
import {
  emptySupportRunCounters,
  type StoredSupportObservation,
} from "./schema"

const observation: StoredSupportObservation = {
  source: {
    sourceId: "1",
    mailboxId: "9",
    createdAt: "2026-08-01T10:00:00.000Z",
    subject: "Language picker unclear",
    excerpt: "I cannot find my language.",
    watchUrls: [],
    redactionCount: 0,
    truncated: false,
  },
  analysis: {
    relevant: true,
    kind: "usability",
    surface: "language_selection",
    title: "Language picker is hard to discover",
    summary: "A user could not discover language selection.",
    reportedEvidence: ["I cannot find my language."],
    themeKey: "language-picker-discovery",
    confidence: 0.9,
    actionability: 0.85,
    validationRecommended: false,
    validationTarget: "none",
    inference: "The flow may need research.",
  },
  validation: {
    state: "not_attempted",
    evidence: [],
    missingProof: "No URL was supplied.",
  },
  fingerprint: "a".repeat(64),
  analyzedAt: "2026-08-01T10:05:00.000Z",
}

describe("daily support report", () => {
  it("groups findings by fingerprint without storing transcripts", () => {
    const report = buildSupportRunReport({
      runKey: "support-research:2026-08-01",
      status: "complete",
      dryRun: false,
      cutoff: "2026-08-02T00:00:00.000Z",
      cursorStart: "2026-08-01T00:00:00.000Z",
      cursorEnd: "2026-08-02T00:00:00.000Z",
      counters: emptySupportRunCounters(),
      observations: [
        observation,
        { ...observation, source: { ...observation.source, sourceId: "2" } },
      ],
      actionUrls: [],
      errors: [],
    })

    expect(report.findings).toEqual([
      expect.objectContaining({
        sourceCount: 2,
        title: observation.analysis.title,
      }),
    ])
    expect(JSON.stringify(report)).not.toContain(observation.source.excerpt)
  })

  it("creates one concise dated summary only when relevant findings exist", () => {
    const summary = buildDailySummaryAction({
      runKey: "support-research:2026-08-01",
      date: "2026-08-01",
      observations: [observation],
      createdIssueUrls: ["https://linear.app/team/issue/FGE-1"],
    })

    expect(summary).toMatchObject({
      type: "daily_summary",
      title: "Support insights — 2026-08-01",
      sourceIds: ["1"],
    })
    expect(summary?.description).toContain(
      "durable Mastra report is authoritative",
    )
    expect(summary?.description).toContain(
      "https://linear.app/team/issue/FGE-1",
    )
    expect(
      buildDailySummaryAction({
        runKey: "support-research:2026-08-01",
        date: "2026-08-01",
        observations: [observation],
        createdIssueUrls: [],
      })?.description,
    ).toContain("Product action results are recorded in the durable run report")
    expect(
      buildDailySummaryAction({
        runKey: "support-research:2026-08-01",
        date: "2026-08-01",
        observations: [
          {
            ...observation,
            analysis: { ...observation.analysis, relevant: false },
          },
        ],
        createdIssueUrls: [],
      }),
    ).toBeUndefined()
  })
})
