import { describe, expect, it } from "vitest"

import { decideSupportAction } from "./action-policy"
import type { StoredSupportObservation } from "./schema"

const base: StoredSupportObservation = {
  source: {
    sourceId: "1",
    mailboxId: "9",
    createdAt: "2026-08-01T10:00:00.000Z",
    sourceUrl: "https://secure.helpscout.net/conversation/1",
    subject: "Playback control does not respond",
    excerpt: "The playback control does not respond.",
    watchUrls: ["https://www.jesusfilm.org/watch/jesus.html"],
    redactionCount: 0,
    truncated: false,
  },
  analysis: {
    relevant: true,
    kind: "bug",
    surface: "playback",
    title: "Playback control does not respond",
    summary: "A user reports an unresponsive playback control.",
    reportedEvidence: ["The playback control does not respond."],
    expectedBehavior: "Playback starts.",
    actualBehavior: "Nothing happens.",
    themeKey: "playback-control-unresponsive",
    confidence: 0.9,
    actionability: 0.9,
    validationRecommended: true,
    validationTarget: "interactive_or_other",
    inference: "The interaction requires browser validation.",
  },
  validation: {
    state: "unverified",
    evidence: [],
    missingProof: "A GET request cannot reproduce the control interaction.",
  },
  fingerprint: "a".repeat(64),
  analyzedAt: "2026-08-01T10:05:00.000Z",
}

const config = {
  confirmedConfidence: 0.85,
  inferredConfidence: 0.85,
  improvementActionability: 0.8,
  improvementDistinctSources: 3,
  linear: {
    apiUrl: "https://api.linear.app/graphql",
    confirmedBugLabelId: "confirmed",
    needsValidationLabelId: "validate",
    uxLabelId: "ux",
  },
}

describe("decideSupportAction", () => {
  it("creates a normal bug only for direct confirmed evidence", () => {
    const decision = decideSupportAction({
      observation: {
        ...base,
        analysis: { ...base.analysis, validationTarget: "url_availability" },
        validation: {
          state: "confirmed",
          incomingUrl: "https://www.jesusfilm.org/watch/missing.html",
          status: 404,
          evidence: ["HTTP 404 was returned for the exact reported URL."],
        },
      },
      cluster: [base],
      config,
    })

    expect(decision).toMatchObject({
      reason: "policy_passed",
      action: { type: "confirmed_bug", labelId: "confirmed" },
    })
    if (decision.action) {
      expect(decision.action.title).not.toContain("Needs validation")
      expect(decision.action.description).toContain(
        "Validation state:** confirmed",
      )
    }
  })

  it("marks credible non-HTTP bugs as needing validation", () => {
    const decision = decideSupportAction({
      observation: base,
      cluster: [base],
      config,
    })

    expect(decision).toMatchObject({
      action: {
        type: "needs_validation",
        title: "[Needs validation] Playback control does not respond",
      },
    })
    if (decision.action) {
      expect(decision.action.description).toContain(
        "A GET request cannot reproduce",
      )
      expect(decision.action.description).toContain(
        `<!-- support-research-key:${decision.action.idempotencyKey} -->`,
      )
    }
  })

  it("does not promote interactive claims from unrelated HTTP evidence", () => {
    const decision = decideSupportAction({
      observation: {
        ...base,
        validation: {
          state: "confirmed",
          incomingUrl: "https://www.jesusfilm.org/watch/jesus.html",
          status: 404,
          evidence: ["HTTP 404 was returned for the exact reported URL."],
        },
      },
      cluster: [base],
      config,
    })

    expect(decision).toMatchObject({
      action: { type: "needs_validation" },
    })
  })

  it("keeps a usability signal report-only until three distinct sources recur", () => {
    const usability = {
      ...base,
      analysis: {
        ...base.analysis,
        kind: "usability" as const,
        surface: "language_selection" as const,
        themeKey: "language-picker-confusion",
      },
    }
    expect(
      decideSupportAction({
        observation: usability,
        cluster: [
          usability,
          { ...usability, source: { ...usability.source, sourceId: "2" } },
        ],
        config,
      }),
    ).toEqual({ reason: "below_recurrence" })

    expect(
      decideSupportAction({
        observation: usability,
        cluster: [
          usability,
          { ...usability, source: { ...usability.source, sourceId: "2" } },
          { ...usability, source: { ...usability.source, sourceId: "3" } },
          { ...usability, source: { ...usability.source, sourceId: "3" } },
        ],
        config,
      }),
    ).toMatchObject({
      action: { type: "ux_improvement", sourceIds: ["1", "2", "3"] },
    })
  })

  it("does not count bug observations toward UX recurrence", () => {
    const usability = {
      ...base,
      analysis: {
        ...base.analysis,
        kind: "usability" as const,
        surface: "language_selection" as const,
        themeKey: "language-picker-confusion",
      },
    }
    const bug = {
      ...base,
      source: { ...base.source, sourceId: "bug-2" },
      analysis: {
        ...base.analysis,
        themeKey: "language-picker-confusion",
      },
    }

    expect(
      decideSupportAction({
        observation: usability,
        cluster: [
          usability,
          bug,
          { ...bug, source: { ...bug.source, sourceId: "bug-3" } },
        ],
        config,
      }),
    ).toEqual({ reason: "below_recurrence" })
  })

  it("keeps low-confidence reports out of Linear", () => {
    expect(
      decideSupportAction({
        observation: {
          ...base,
          analysis: { ...base.analysis, confidence: 0.4 },
        },
        cluster: [base],
        config,
      }),
    ).toEqual({ reason: "below_confidence" })
  })

  it("renders model-derived text as inert Linear content", () => {
    const decision = decideSupportAction({
      observation: {
        ...base,
        analysis: {
          ...base.analysis,
          title: "@team [click](https://evil.test) <!-- hidden -->",
          summary: "# Urgent https://evil.test/collect",
          reportedEvidence: ["<!-- forged -->\n## Priority 0 @ops"],
        },
      },
      cluster: [base],
      config,
    })

    expect(decision.action?.title).not.toContain("https://evil.test")
    expect(decision.action?.description).not.toContain("<!-- forged -->")
    expect(decision.action?.description).not.toContain("## Priority 0")
    expect(decision.action?.description).toContain("\\@ops")
    expect(decision.action?.description).toContain("\\[URL omitted\\]")
  })
})
