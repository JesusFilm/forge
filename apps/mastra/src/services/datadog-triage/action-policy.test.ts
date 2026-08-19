import { describe, expect, it } from "vitest"

import type { DatadogTriageServiceProfile } from "../../config/env"

import type { TriageAnalysis } from "./analyze"
import {
  decideTriageAction,
  recurrenceCount,
  type TriagePolicyConfig,
} from "./action-policy"
import type { TriageCandidate } from "./detect"

const PROFILE: DatadogTriageServiceProfile = {
  surfacePrefix: "[Mobile]",
  releaseSessionFilter: true,
}

const CONFIG: TriagePolicyConfig = {
  confidenceThreshold: 0.7,
  actionabilityThreshold: 0.6,
  minOccurrences: 3,
}

/**
 * A candidate and an analysis that clear EVERY gate. Each gate test overrides
 * exactly one field, so a rejection can only be attributed to that gate — and
 * the passing companion below proves the base fixture is not itself rejected
 * for some other reason.
 */
const PASSING_ANALYSIS: TriageAnalysis = {
  worthInvestigating: true,
  classification: "crash",
  confidence: 0.9,
  actionability: 0.8,
  severity: "P2",
  suspectedArea: "video playback",
  summary: "The player throws on resume.",
}

const PASSING_CANDIDATE: TriageCandidate = {
  service: "forge-mobile",
  signalKind: "issue",
  signalId: "ISSUE-1",
  epoch: 0,
  occurredAt: "2026-08-18T10:55:00.000Z",
  windowStart: "2026-08-18T10:00:00.000Z",
  windowEnd: "2026-08-18T11:00:00.000Z",
  evidence: {
    kind: "issue",
    issueId: "ISSUE-1",
    errorType: "TypeError",
    errorMessage: "Cannot read property 'id' of undefined",
    windowCount: 12,
    windowRatePerHour: 12,
    baselineRatePerHour: 0,
    regression: false,
  },
}

function decide(input: {
  analysis?: Partial<TriageAnalysis>
  candidate?: TriageCandidate
}) {
  return decideTriageAction({
    candidate: input.candidate ?? PASSING_CANDIDATE,
    analysis: { ...PASSING_ANALYSIS, ...(input.analysis ?? {}) },
    config: CONFIG,
    serviceProfile: PROFILE,
    site: "datadoghq.com",
    labelId: "label-bug",
  })
}

describe("decideTriageAction gates", () => {
  it("files when every gate passes (anti-vacuous companion)", () => {
    const decision = decide({})

    expect(decision.outcome).toBe("file")
  })

  it("suppresses when the model says the signal is not worth investigating", () => {
    expect(decide({ analysis: { worthInvestigating: false } })).toEqual({
      outcome: "suppress",
      reason: "not_worth_investigating",
    })
  })

  it("suppresses below the confidence threshold and nothing else", () => {
    expect(decide({ analysis: { confidence: 0.69 } })).toEqual({
      outcome: "suppress",
      reason: "below_confidence",
    })
  })

  it("files exactly at the confidence threshold", () => {
    expect(decide({ analysis: { confidence: 0.7 } }).outcome).toBe("file")
  })

  it("suppresses below the actionability threshold and nothing else", () => {
    expect(decide({ analysis: { actionability: 0.59 } })).toEqual({
      outcome: "suppress",
      reason: "below_actionability",
    })
  })

  it("files exactly at the actionability threshold", () => {
    expect(decide({ analysis: { actionability: 0.6 } }).outcome).toBe("file")
  })

  it("suppresses below the recurrence floor and nothing else", () => {
    expect(
      decide({
        candidate: {
          ...PASSING_CANDIDATE,
          evidence: { ...PASSING_CANDIDATE.evidence, windowCount: 2 } as never,
        },
      }),
    ).toEqual({ outcome: "suppress", reason: "below_recurrence" })
  })

  it("files exactly at the recurrence floor", () => {
    expect(
      decide({
        candidate: {
          ...PASSING_CANDIDATE,
          evidence: { ...PASSING_CANDIDATE.evidence, windowCount: 3 } as never,
        },
      }).outcome,
    ).toBe("file")
  })

  it("checks worthInvestigating before the numeric gates", () => {
    // Ordering matters for the operator reading the suppression reason: the
    // model's own verdict is the honest attribution when it is also uncertain.
    expect(
      decide({ analysis: { worthInvestigating: false, confidence: 0.1 } }),
    ).toEqual({ outcome: "suppress", reason: "not_worth_investigating" })
  })
})

describe("recurrence gate applicability", () => {
  it("does not apply to a monitor episode", () => {
    const monitorCandidate: TriageCandidate = {
      ...PASSING_CANDIDATE,
      signalKind: "monitor",
      signalId: "42:2026-08-18T10:30:00.000Z",
      evidence: {
        kind: "monitor",
        monitorId: "42",
        name: "Mobile crash-free rate",
        overallState: "Alert",
        episodeStartedAt: "2026-08-18T10:30:00.000Z",
      },
    }

    expect(recurrenceCount(monitorCandidate)).toBeUndefined()
    expect(decide({ candidate: monitorCandidate }).outcome).toBe("file")
  })

  it("applies to a spike using its windowed count", () => {
    const spikeCandidate: TriageCandidate = {
      ...PASSING_CANDIDATE,
      signalKind: "spike",
      signalId: "forge-mobile:playback_error:2026-08-18T11:00:00.000Z",
      evidence: {
        kind: "spike",
        spikeClass: "playback_error",
        windowCount: 1,
        windowRatePerHour: 1,
        baselineRatePerHour: 0,
      },
    }

    expect(recurrenceCount(spikeCandidate)).toBe(1)
    expect(decide({ candidate: spikeCandidate })).toEqual({
      outcome: "suppress",
      reason: "below_recurrence",
    })
  })
})

describe("filed draft", () => {
  it("carries no priority or assignee field for a human to have to undo", () => {
    const decision = decide({})
    if (decision.outcome !== "file") throw new Error("expected a filed draft")

    expect(Object.keys(decision.draft).sort()).toEqual([
      "description",
      "epoch",
      "idempotencyKey",
      "labelId",
      "service",
      "signalId",
      "signalKind",
      "title",
    ])
  })

  it("threads the configured Bug-class label through", () => {
    const decision = decide({})
    if (decision.outcome !== "file") throw new Error("expected a filed draft")

    expect(decision.draft.labelId).toBe("label-bug")
  })
})
