import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  buildReviewSubmissionPayload,
  SubtitleReviewForm,
  claimReviewSubmission,
  validateReviewDraft,
  type SubtitleReviewDraft,
  type SubtitleTrackAssessmentDraft,
} from "./subtitle-review-form"

const completeTrackAssessment: SubtitleTrackAssessmentDraft = {
  meaningAccuracyScore: 4,
  naturalnessScore: 4,
  timingReadabilityScore: 3,
  scriptureTheologyScore: null,
  issueCodes: ["TIMING"],
  criticalMeaningLoss: false,
  criticalHarmful: false,
  criticalScriptureRisk: false,
}

const completeDraft: SubtitleReviewDraft = {
  trackAssessments: {
    trackA: { ...completeTrackAssessment, issueCodes: ["TIMING"] },
    trackB: { ...completeTrackAssessment, issueCodes: ["NATURALNESS"] },
  },
  verdict: "NEEDS_CHANGES",
  questionableTrack: null,
  notes: "One timing adjustment.",
  corrections: [{ segmentId: "segment-1", track: "B", text: "Better line" }],
}

describe("subtitle review form", () => {
  it("requires all base rubric scores and enforces correction and notes bounds", () => {
    expect(
      validateReviewDraft(
        {
          ...completeDraft,
          trackAssessments: {
            ...completeDraft.trackAssessments,
            trackA: {
              ...completeDraft.trackAssessments.trackA,
              meaningAccuracyScore: null,
            },
          },
        },
        false,
      ),
    ).toContain("Score Track A meaning accuracy")
    expect(
      validateReviewDraft(
        {
          ...completeDraft,
          corrections: [
            { segmentId: "segment-1", track: "A", text: "x".repeat(1_001) },
          ],
        },
        false,
      ),
    ).toContain("Correction text must be 1,000 characters or fewer")
    expect(
      validateReviewDraft(
        { ...completeDraft, notes: "x".repeat(4_001) },
        false,
      ),
    ).toContain("Notes must be 4,000 characters or fewer")
  })

  it("allows the scripture/theology score only for a qualified specialist", () => {
    expect(
      validateReviewDraft(
        {
          ...completeDraft,
          trackAssessments: {
            ...completeDraft.trackAssessments,
            trackB: {
              ...completeDraft.trackAssessments.trackB,
              scriptureTheologyScore: 4,
            },
          },
        },
        false,
      ),
    ).toContain("Track B scripture/theology scoring is not available")
    expect(
      validateReviewDraft(
        {
          ...completeDraft,
          trackAssessments: {
            ...completeDraft.trackAssessments,
            trackB: {
              ...completeDraft.trackAssessments.trackB,
              scriptureTheologyScore: 4,
            },
          },
        },
        true,
      ),
    ).toEqual([])
  })

  it("requires a reference issue for escalation and rejects a duplicate pending submit", () => {
    expect(
      validateReviewDraft(
        {
          ...completeDraft,
          verdict: "REFERENCE_QUESTIONABLE",
          questionableTrack: null,
        },
        false,
      ),
    ).toContain("Choose whether Track A or Track B is questionable")
    expect(
      validateReviewDraft(
        {
          ...completeDraft,
          verdict: "REFERENCE_QUESTIONABLE",
          questionableTrack: "B",
          trackAssessments: {
            ...completeDraft.trackAssessments,
            trackB: {
              ...completeDraft.trackAssessments.trackB,
              issueCodes: [],
            },
          },
        },
        false,
      ),
    ).toContain("Select Reference error for questionable Track B")

    const pending = { current: false }
    expect(claimReviewSubmission(pending)).toBe(true)
    expect(claimReviewSubmission(pending)).toBe(false)
  })

  it("renders identical, independently labelled blind rubrics for Track A and Track B", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleReviewForm, {
        assignmentId: "assignment-private",
        segments: [],
        specialistAllowed: false,
        onSubmitted: async () => undefined,
      }),
    )

    expect(markup).toContain("Assess Track A")
    expect(markup).toContain("Assess Track B")
    expect(markup.match(/Meaning accuracy/g)).toHaveLength(2)
    expect(markup.match(/Target-language naturalness/g)).toHaveLength(2)
    expect(markup.match(/Timing and readability/g)).toHaveLength(2)
    expect(markup.match(/Observed issues/g)).toHaveLength(2)
    expect(markup.match(/Critical-error flags/g)).toHaveLength(2)
    expect(markup.match(/Identity hidden/g)).toHaveLength(2)
    expect(markup).toContain("Append review")
    expect(markup).not.toContain("Scripture / theology score")
    expect(markup).not.toContain("Human reference")
    expect(markup).not.toContain("AI candidate")
    expect(markup).not.toContain("assignment-private")
    expect(
      markup.match(
        /<span class="sr-only">Unusable or meaningfully wrong<\/span>/g,
      ),
    ).toHaveLength(6)
    expect(
      markup.match(/<span class="sr-only">Publication-quality<\/span>/g),
    ).toHaveLength(6)
    expect(markup).toContain('name="track-a-meaning-accuracy"')
    expect(markup).toContain('name="track-b-meaning-accuracy"')
  })

  it("builds a seed-independent contract with both blind assessments and no provenance", () => {
    const payload = buildReviewSubmissionPayload({
      assignmentId: "assignment-private",
      draft: completeDraft,
      idempotencyKey: "stable-review-key",
      specialistAllowed: false,
      supersedesReviewId: null,
    })

    expect(payload).toMatchObject({
      idempotencyKey: "stable-review-key",
      assignmentId: "assignment-private",
      rubricVersion: 1,
      trackAssessments: {
        trackA: {
          meaningAccuracyScore: 4,
          issueCodes: ["TIMING"],
          scriptureTheologyScore: null,
        },
        trackB: {
          naturalnessScore: 4,
          issueCodes: ["NATURALNESS"],
          scriptureTheologyScore: null,
        },
      },
      questionableTrack: null,
    })
    expect(JSON.stringify(payload)).not.toMatch(
      /presentationSeed|referenceTrack|candidateTrack|provenance/i,
    )
  })

  it("shows the same optional specialist dimension for both blind tracks", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleReviewForm, {
        assignmentId: "assignment-private",
        segments: [],
        specialistAllowed: true,
        onSubmitted: async () => undefined,
      }),
    )

    expect(markup.match(/Scripture \/ theology score/g)).toHaveLength(2)
    expect(markup).toContain('name="track-a-scripture-theology"')
    expect(markup).toContain('name="track-b-scripture-theology"')
  })

  it("hides and rejects recursive escalation on a specialist assignment", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SubtitleReviewForm, {
        assignmentId: "assignment-specialist",
        segments: [],
        specialistAllowed: true,
        allowSpecialistEscalation: false,
        onSubmitted: async () => undefined,
      }),
    )
    expect(markup).not.toContain("Specialist review")
    expect(
      validateReviewDraft(
        { ...completeDraft, verdict: "SPECIALIST_REVIEW" },
        true,
        false,
      ),
    ).toContain("A specialist review cannot request another specialist round")
  })

  it("keeps the same idempotency key and blind labels when building a retry", () => {
    const first = buildReviewSubmissionPayload({
      assignmentId: "assignment-private",
      draft: completeDraft,
      idempotencyKey: "stable-review-key",
      specialistAllowed: false,
      supersedesReviewId: null,
    })
    const retry = buildReviewSubmissionPayload({
      assignmentId: "assignment-private",
      draft: completeDraft,
      idempotencyKey: "stable-review-key",
      specialistAllowed: false,
      supersedesReviewId: null,
    })

    expect(retry).toEqual(first)
    expect(Object.keys(retry.trackAssessments)).toEqual(["trackA", "trackB"])
  })
})
