"use client"

import { useEffect, useRef, useState } from "react"

import type { AlignedSubtitleSegment } from "./subtitle-review-presenter"

export const REVIEW_ISSUE_CODES = [
  "MISTRANSLATION",
  "OMISSION",
  "ADDITION",
  "TERMINOLOGY",
  "GRAMMAR",
  "NATURALNESS",
  "TONE_REGISTER",
  "TIMING",
  "LINE_BREAK",
  "READING_SPEED",
  "SCRIPTURE",
  "THEOLOGY",
  "REFERENCE_ERROR",
  "OTHER",
] as const

type ReviewIssueCode = (typeof REVIEW_ISSUE_CODES)[number]
type ReviewVerdict =
  | "PASS"
  | "NEEDS_CHANGES"
  | "REFERENCE_QUESTIONABLE"
  | "SPECIALIST_REVIEW"
type ReviewScore = 1 | 2 | 3 | 4 | 5 | null
type BlindTrack = "A" | "B"

export type SubtitleReviewCorrection = {
  segmentId: string
  track: BlindTrack
  text: string
}

export type SubtitleTrackAssessmentDraft = {
  meaningAccuracyScore: ReviewScore
  naturalnessScore: ReviewScore
  timingReadabilityScore: ReviewScore
  scriptureTheologyScore: ReviewScore
  issueCodes: ReviewIssueCode[]
  criticalMeaningLoss: boolean
  criticalHarmful: boolean
  criticalScriptureRisk: boolean
}

export type SubtitleReviewDraft = {
  trackAssessments: {
    trackA: SubtitleTrackAssessmentDraft
    trackB: SubtitleTrackAssessmentDraft
  }
  verdict: ReviewVerdict | null
  questionableTrack: BlindTrack | null
  notes: string
  corrections: SubtitleReviewCorrection[]
}

function emptyTrackAssessment(): SubtitleTrackAssessmentDraft {
  return {
    meaningAccuracyScore: null,
    naturalnessScore: null,
    timingReadabilityScore: null,
    scriptureTheologyScore: null,
    issueCodes: [],
    criticalMeaningLoss: false,
    criticalHarmful: false,
    criticalScriptureRisk: false,
  }
}

const initialDraft: SubtitleReviewDraft = {
  trackAssessments: {
    trackA: emptyTrackAssessment(),
    trackB: emptyTrackAssessment(),
  },
  verdict: null,
  questionableTrack: null,
  notes: "",
  corrections: [],
}

export function validateReviewDraft(
  draft: SubtitleReviewDraft,
  specialistAllowed: boolean,
  allowSpecialistEscalation = true,
): string[] {
  const errors: string[] = []
  errors.push(
    ...validateTrackAssessment(
      draft.trackAssessments.trackA,
      "A",
      specialistAllowed,
    ),
    ...validateTrackAssessment(
      draft.trackAssessments.trackB,
      "B",
      specialistAllowed,
    ),
  )
  if (!draft.verdict) errors.push("Choose a verdict")
  if (draft.verdict === "SPECIALIST_REVIEW" && !allowSpecialistEscalation) {
    errors.push("A specialist review cannot request another specialist round")
  }
  if (draft.notes.length > 4_000) {
    errors.push("Notes must be 4,000 characters or fewer")
  }
  if (draft.corrections.length > 100) {
    errors.push("A review can contain at most 100 corrections")
  }
  if (draft.corrections.some(({ text }) => text.length > 1_000)) {
    errors.push("Correction text must be 1,000 characters or fewer")
  }
  if (draft.corrections.some(({ text }) => text.trim().length === 0)) {
    errors.push("Correction text cannot be empty")
  }
  if (draft.verdict === "REFERENCE_QUESTIONABLE") {
    if (!draft.questionableTrack) {
      errors.push("Choose whether Track A or Track B is questionable")
    } else if (
      !assessmentForTrack(draft, draft.questionableTrack).issueCodes.includes(
        "REFERENCE_ERROR",
      )
    ) {
      errors.push(
        `Select Reference error for questionable Track ${draft.questionableTrack}`,
      )
    }
  } else if (draft.questionableTrack != null) {
    errors.push("Questionable track is only available for that verdict")
  }
  return errors
}

function validateTrackAssessment(
  assessment: SubtitleTrackAssessmentDraft,
  track: BlindTrack,
  specialistAllowed: boolean,
) {
  const errors: string[] = []
  if (assessment.meaningAccuracyScore == null) {
    errors.push(`Score Track ${track} meaning accuracy`)
  }
  if (assessment.naturalnessScore == null) {
    errors.push(`Score Track ${track} target-language naturalness`)
  }
  if (assessment.timingReadabilityScore == null) {
    errors.push(`Score Track ${track} timing and readability`)
  }
  if (!specialistAllowed && assessment.scriptureTheologyScore != null) {
    errors.push(`Track ${track} scripture/theology scoring is not available`)
  }
  return errors
}

export function buildReviewSubmissionPayload({
  assignmentId,
  draft,
  idempotencyKey,
  specialistAllowed,
  supersedesReviewId,
}: {
  assignmentId: string
  draft: SubtitleReviewDraft
  idempotencyKey: string
  specialistAllowed: boolean
  supersedesReviewId: string | null
}) {
  return {
    idempotencyKey,
    assignmentId,
    rubricVersion: 1,
    trackAssessments: {
      trackA: normalizeTrackAssessment(
        draft.trackAssessments.trackA,
        specialistAllowed,
      ),
      trackB: normalizeTrackAssessment(
        draft.trackAssessments.trackB,
        specialistAllowed,
      ),
    },
    verdict: draft.verdict,
    questionableTrack: draft.questionableTrack,
    notes: draft.notes.trim() || null,
    corrections: draft.corrections,
    supersedesReviewId,
  }
}

function normalizeTrackAssessment(
  assessment: SubtitleTrackAssessmentDraft,
  specialistAllowed: boolean,
) {
  return {
    meaningAccuracyScore: assessment.meaningAccuracyScore,
    naturalnessScore: assessment.naturalnessScore,
    timingReadabilityScore: assessment.timingReadabilityScore,
    scriptureTheologyScore: specialistAllowed
      ? assessment.scriptureTheologyScore
      : null,
    issueCodes: assessment.issueCodes,
    criticalMeaningLoss: assessment.criticalMeaningLoss,
    criticalHarmful: assessment.criticalHarmful,
    criticalScriptureRisk: assessment.criticalScriptureRisk,
  }
}

function assessmentForTrack(draft: SubtitleReviewDraft, track: BlindTrack) {
  return track === "A"
    ? draft.trackAssessments.trackA
    : draft.trackAssessments.trackB
}

export function claimReviewSubmission(pending: { current: boolean }) {
  if (pending.current) return false
  pending.current = true
  return true
}

export function SubtitleReviewForm({
  assignmentId,
  segments,
  specialistAllowed,
  allowSpecialistEscalation = true,
  requestedCorrection,
  supersedesReviewId = null,
  onSubmitted,
}: {
  assignmentId: string
  segments: readonly AlignedSubtitleSegment[]
  specialistAllowed: boolean
  allowSpecialistEscalation?: boolean
  requestedCorrection?: {
    segmentId: string
    track: "A" | "B"
    nonce: number
  }
  supersedesReviewId?: string | null
  onSubmitted: () => Promise<void> | void
}) {
  const [draft, setDraft] = useState<SubtitleReviewDraft>(initialDraft)
  const [errors, setErrors] = useState<string[]>([])
  const [submitState, setSubmitState] = useState<"idle" | "pending" | "error">(
    "idle",
  )
  const idempotencyKey = useRef(randomReviewId())
  const submissionPending = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const validationRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!requestedCorrection) return
    setDraft((current) => {
      if (
        current.corrections.some(
          (correction) =>
            correction.segmentId === requestedCorrection.segmentId &&
            correction.track === requestedCorrection.track,
        ) ||
        current.corrections.length >= 100
      ) {
        return current
      }
      return {
        ...current,
        corrections: [
          ...current.corrections,
          {
            segmentId: requestedCorrection.segmentId,
            track: requestedCorrection.track,
            text: "",
          },
        ],
      }
    })
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [requestedCorrection])

  useEffect(() => {
    if (errors.length > 0) validationRef.current?.focus()
  }, [errors])

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!claimReviewSubmission(submissionPending)) return
    const nextErrors = validateReviewDraft(
      draft,
      specialistAllowed,
      allowSpecialistEscalation,
    )
    setErrors(nextErrors)
    if (nextErrors.length > 0) {
      submissionPending.current = false
      return
    }

    setSubmitState("pending")
    try {
      const response = await fetch("/api/subtitle-lab/reviews", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildReviewSubmissionPayload({
            idempotencyKey: idempotencyKey.current,
            assignmentId,
            draft,
            specialistAllowed,
            supersedesReviewId,
          }),
        ),
      })
      if (!response.ok) throw new Error("Review submission was rejected")
      await onSubmitted()
    } catch {
      submissionPending.current = false
      setSubmitState("error")
    }
  }

  function updateTrackAssessment(
    track: BlindTrack,
    update: (
      current: SubtitleTrackAssessmentDraft,
    ) => SubtitleTrackAssessmentDraft,
  ) {
    const key = track === "A" ? "trackA" : "trackB"
    setDraft((current) => ({
      ...current,
      trackAssessments: {
        ...current.trackAssessments,
        [key]: update(current.trackAssessments[key]),
      },
    }))
  }

  return (
    <form
      ref={formRef}
      className="subtitle-review-form"
      onSubmit={submitReview}
      aria-busy={submitState === "pending"}
      noValidate
    >
      <header className="subtitle-review-form-heading">
        <div>
          <p className="subtitle-review-eyebrow">Rubric V1</p>
          <h2>
            {supersedesReviewId ? "Append a correction" : "Your human review"}
          </h2>
          <p>
            Assess Track A and Track B independently. Both identities stay
            hidden until after submission; neither label implies which track was
            created by a human or by AI.
          </p>
        </div>
      </header>

      {errors.length > 0 ? (
        <div
          ref={validationRef}
          className="subtitle-review-validation"
          role="alert"
          tabIndex={-1}
        >
          <strong>Complete the highlighted review fields:</strong>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div
        className="subtitle-review-track-assessments"
        aria-label="Blind track assessments"
      >
        {(["A", "B"] as const).map((track) => (
          <TrackAssessmentSection
            key={track}
            track={track}
            assessment={assessmentForTrack(draft, track)}
            specialistAllowed={specialistAllowed}
            onChange={(update) => updateTrackAssessment(track, update)}
          />
        ))}
      </div>

      <fieldset className="subtitle-review-fieldset">
        <legend>Verdict</legend>
        <p className="small">
          Choose the action this evidence supports. A questionable reference or
          specialist request creates a separate follow-up; it does not rewrite
          prior evidence.
        </p>
        <div className="subtitle-review-choice-grid">
          {(
            [
              ["PASS", "Pass"],
              ["NEEDS_CHANGES", "Needs changes"],
              ["REFERENCE_QUESTIONABLE", "Reference questionable"],
              ...(allowSpecialistEscalation
                ? [["SPECIALIST_REVIEW", "Specialist review"] as const]
                : []),
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="subtitle-review-choice">
              <input
                type="radio"
                name="verdict"
                value={value}
                checked={draft.verdict === value}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    verdict: value,
                    questionableTrack:
                      value === "REFERENCE_QUESTIONABLE"
                        ? current.questionableTrack
                        : null,
                  }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {draft.verdict === "REFERENCE_QUESTIONABLE" ? (
        <fieldset className="subtitle-review-fieldset">
          <legend>Questionable track</legend>
          <p className="small">
            Select the blind track whose subtitle quality makes the comparison
            standard questionable. Track identity remains hidden until this
            review is submitted.
          </p>
          <div className="subtitle-review-choice-grid">
            {(["A", "B"] as const).map((track) => (
              <label key={track} className="subtitle-review-choice">
                <input
                  type="radio"
                  name="questionable-track"
                  value={track}
                  required
                  checked={draft.questionableTrack === track}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      questionableTrack: track,
                    }))
                  }
                />
                <span>Track {track}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <section
        className="subtitle-review-fieldset"
        aria-labelledby="corrections-title"
      >
        <h3 id="corrections-title">Segment corrections</h3>
        <p className="small">
          Use Correct on Track A or Track B above. Corrections stay relative to
          the blind labels and are mapped server-side.
        </p>
        {draft.corrections.length === 0 ? (
          <p className="subtitle-review-empty-corrections">
            No corrections added.
          </p>
        ) : (
          <div className="subtitle-review-corrections">
            {draft.corrections.map((correction, index) => (
              <label
                key={`${correction.segmentId}-${correction.track}`}
                className="subtitle-review-correction"
              >
                <span>
                  Segment {segmentPosition(segments, correction.segmentId)} ·
                  Track {correction.track}
                </span>
                <textarea
                  value={correction.text}
                  maxLength={1_000}
                  rows={3}
                  dir="auto"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      corrections: current.corrections.map((value, position) =>
                        position === index
                          ? { ...value, text: event.target.value }
                          : value,
                      ),
                    }))
                  }
                />
                <span className="subtitle-review-input-meta">
                  {correction.text.length}/1,000
                  <button
                    type="button"
                    className="subtitle-review-text-button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        corrections: current.corrections.filter(
                          (_, position) => position !== index,
                        ),
                      }))
                    }
                  >
                    Remove
                  </button>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <label className="subtitle-review-notes">
        <span>Reviewer notes</span>
        <textarea
          value={draft.notes}
          maxLength={4_000}
          rows={6}
          dir="auto"
          onChange={(event) =>
            setDraft((current) => ({ ...current, notes: event.target.value }))
          }
        />
        <span className="subtitle-review-input-meta">
          {draft.notes.length}/4,000
        </span>
      </label>

      {submitState === "error" ? (
        <p className="subtitle-review-submit-error" role="alert">
          Your review was not submitted. Your entered work is still here; try
          again when the service is available.
        </p>
      ) : null}

      <div className="subtitle-review-form-actions">
        <button
          type="submit"
          className="subtitle-review-primary-button"
          disabled={submitState === "pending"}
        >
          {submitState === "pending"
            ? "Appending review…"
            : supersedesReviewId
              ? "Append correction"
              : "Append review"}
        </button>
        <span className="small">Submission is append-only and versioned.</span>
      </div>
    </form>
  )
}

function TrackAssessmentSection({
  track,
  assessment,
  specialistAllowed,
  onChange,
}: {
  track: BlindTrack
  assessment: SubtitleTrackAssessmentDraft
  specialistAllowed: boolean
  onChange: (
    update: (
      current: SubtitleTrackAssessmentDraft,
    ) => SubtitleTrackAssessmentDraft,
  ) => void
}) {
  const prefix = `track-${track.toLocaleLowerCase()}`
  const titleId = `${prefix}-assessment-title`
  const updateField = <Key extends keyof SubtitleTrackAssessmentDraft>(
    field: Key,
    value: SubtitleTrackAssessmentDraft[Key],
  ) => onChange((current) => ({ ...current, [field]: value }))

  return (
    <section
      className="subtitle-review-track-assessment"
      aria-labelledby={titleId}
    >
      <header className="subtitle-review-track-assessment-heading">
        <div>
          <p className="subtitle-review-eyebrow">Blind assessment</p>
          <h3 id={titleId}>Assess Track {track}</h3>
        </div>
        <span className="subtitle-review-blind-badge">Identity hidden</span>
      </header>
      <p className="small">
        Judge only Track {track} against the source and video. Do not infer its
        origin from wording, timing, or order.
      </p>

      <div className="subtitle-review-score-grid">
        <ScoreField
          context={`Track ${track}`}
          legend="Meaning accuracy"
          description={`How faithfully does Track ${track} preserve the source meaning?`}
          name={`${prefix}-meaning-accuracy`}
          value={assessment.meaningAccuracyScore}
          onChange={(score) => updateField("meaningAccuracyScore", score)}
        />
        <ScoreField
          context={`Track ${track}`}
          legend="Target-language naturalness"
          description={`Does Track ${track} sound fluent, appropriate, and culturally natural?`}
          name={`${prefix}-naturalness`}
          value={assessment.naturalnessScore}
          onChange={(score) => updateField("naturalnessScore", score)}
        />
        <ScoreField
          context={`Track ${track}`}
          legend="Timing and readability"
          description={`Can viewers comfortably read Track ${track} while it matches the scene?`}
          name={`${prefix}-timing-readability`}
          value={assessment.timingReadabilityScore}
          onChange={(score) => updateField("timingReadabilityScore", score)}
        />
        {specialistAllowed ? (
          <ScoreField
            context={`Track ${track}`}
            legend="Scripture / theology score"
            description={`Optional specialist judgment for Track ${track}.`}
            name={`${prefix}-scripture-theology`}
            value={assessment.scriptureTheologyScore}
            optional
            onChange={(score) => updateField("scriptureTheologyScore", score)}
          />
        ) : null}
      </div>

      <fieldset className="subtitle-review-fieldset">
        <legend>Observed issues for Track {track}</legend>
        <p className="small">
          Select only issues you judged in Track {track}. Automatic differences
          are neutral scanning aids.
        </p>
        <div className="subtitle-review-issue-grid">
          {REVIEW_ISSUE_CODES.map((code) => (
            <label key={code} className="subtitle-review-check">
              <input
                type="checkbox"
                name={`${prefix}-issue-${code.toLocaleLowerCase()}`}
                checked={assessment.issueCodes.includes(code)}
                onChange={() =>
                  updateField(
                    "issueCodes",
                    assessment.issueCodes.includes(code)
                      ? assessment.issueCodes.filter((value) => value !== code)
                      : [...assessment.issueCodes, code],
                  )
                }
              />
              <span>{humanize(code)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="subtitle-review-fieldset">
        <legend>Critical-error flags for Track {track}</legend>
        <div className="subtitle-review-critical-grid">
          <CriticalFlag
            name={`${prefix}-critical-meaning-loss`}
            label="Meaning loss"
            checked={assessment.criticalMeaningLoss}
            onChange={(checked) => updateField("criticalMeaningLoss", checked)}
          />
          <CriticalFlag
            name={`${prefix}-critical-harmful`}
            label="Harmful or offensive rendering"
            checked={assessment.criticalHarmful}
            onChange={(checked) => updateField("criticalHarmful", checked)}
          />
          <CriticalFlag
            name={`${prefix}-critical-scripture-risk`}
            label="Scripture or theology risk"
            checked={assessment.criticalScriptureRisk}
            onChange={(checked) =>
              updateField("criticalScriptureRisk", checked)
            }
          />
        </div>
      </fieldset>
    </section>
  )
}

function ScoreField({
  context,
  legend,
  description,
  name,
  value,
  optional = false,
  onChange,
}: {
  context: string
  legend: string
  description: string
  name: string
  value: ReviewScore
  optional?: boolean
  onChange: (score: Exclude<ReviewScore, null>) => void
}) {
  return (
    <fieldset className="subtitle-review-score-field">
      <legend>
        <span className="sr-only">{context}: </span>
        {legend} {optional ? <span className="small">(optional)</span> : null}
      </legend>
      <p>{description}</p>
      <div className="subtitle-review-score-options">
        {([1, 2, 3, 4, 5] as const).map((score) => (
          <label key={score} title={scoreDescription(score)}>
            <input
              type="radio"
              name={name}
              value={score}
              required={!optional}
              checked={value === score}
              onChange={() => onChange(score)}
            />
            <span>{score}</span>
            <span className="sr-only">{scoreDescription(score)}</span>
          </label>
        ))}
      </div>
      <div className="subtitle-review-score-scale small">
        <span>1 · unusable</span>
        <span>3 · material edits</span>
        <span>5 · publication-quality</span>
      </div>
    </fieldset>
  )
}

function CriticalFlag({
  name,
  label,
  checked,
  onChange,
}: {
  name: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="subtitle-review-critical-flag">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

function scoreDescription(score: number) {
  if (score === 1) return "Unusable or meaningfully wrong"
  if (score === 2) return "Major changes required"
  if (score === 3) return "Usable with material edits"
  if (score === 4) return "Minor edits required"
  return "Publication-quality"
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLocaleLowerCase()
    .replace(/^./, (character) => character.toLocaleUpperCase())
}

function segmentPosition(
  segments: readonly AlignedSubtitleSegment[],
  segmentId: string,
) {
  const index = segments.findIndex((segment) => segment.id === segmentId)
  return index >= 0 ? index + 1 : "selected"
}

function randomReviewId() {
  return globalThis.crypto.randomUUID()
}
