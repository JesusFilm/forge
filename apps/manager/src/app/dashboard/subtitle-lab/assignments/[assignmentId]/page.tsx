import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Bot, FileCheck2, UserRound } from "lucide-react"

import { SubtitleLabAdminClient } from "@/features/subtitle-lab/subtitle-lab-admin-client"
import { BOUNDED_ID } from "@/features/subtitle-lab/subtitle-lab-contract"
import { requireAuth } from "@/lib/require-auth"

import { OperatorAssignmentEvidence } from "./operator-assignment-evidence"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Subtitle assignment evidence — Studio",
}

const PANEL =
  "rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] p-5"

type BlindAssessment = {
  meaningAccuracyScore: number
  naturalnessScore: number
  timingReadabilityScore: number
  scriptureTheologyScore: number | null
  issueCodes: string[]
  criticalMeaningLoss: boolean
  criticalHarmful: boolean
  criticalScriptureRisk: boolean
}

export type OperatorReviewEvidence = {
  id: string
  verdict: string
  submittedAt: string | null
  referenceTrackLabel: "A" | "B" | null
  candidateTrackLabel: "A" | "B" | null
  questionableTrack: "A" | "B" | null
  questionableRole: "HUMAN_REFERENCE" | "AI_CANDIDATE" | "UNKNOWN" | null
  notes: string | null
  corrections: Array<{ segmentId: string; track: "A" | "B"; text: string }>
  trackA: BlindAssessment | null
  trackB: BlindAssessment | null
  candidateProjection: BlindAssessment | null
}

export default async function SubtitleLabOperatorAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>
}) {
  await requireAuth()
  const { assignmentId } = await params
  if (!BOUNDED_ID.safeParse(assignmentId).success) notFound()
  const assignment = await (
    await SubtitleLabAdminClient.configured()
  ).getOperatorAssignment(assignmentId)
  if (!assignment) notFound()

  const reviewEvidence = presentOperatorReviewEvidence(assignment)
  const machine = record(assignment.machineAssessment)

  return (
    <section className="mx-auto grid w-full max-w-[1600px] gap-5 px-4 py-6 md:px-6">
      <Link
        className="inline-flex w-fit items-center gap-2 text-sm font-semibold"
        href={"/dashboard/subtitle-lab" as Route}
      >
        <ArrowLeft aria-hidden="true" size={17} /> Back to Subtitle Quality Lab
      </Link>

      <header className={PANEL}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="studio-page-eyebrow">
              Operator-only named evidence
            </span>
            <h1 className="mt-1 text-2xl font-semibold">
              {assignment.collectionKey}
            </h1>
            <p className="mt-1 text-sm text-[color:var(--ds-muted)]">
              {assignment.caseId} ·{" "}
              <span dir="auto">{assignment.targetLanguageSlug}</span> ·{" "}
              <span className="font-mono text-xs">
                {assignment.targetLanguageId}
              </span>
            </p>
          </div>
          <span className="rounded-full border border-[color:var(--ds-line-strong)] px-3 py-1 text-xs font-semibold">
            {assignment.kind} · {assignment.status}
          </span>
        </div>
        <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="font-semibold">Assignment</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {assignment.id}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Reviewer</dt>
            <dd className="mt-1" dir="auto">
              {assignment.reviewerDisplayName ?? "Unassigned"}
              {assignment.reviewerEmail ? (
                <span className="block text-xs text-[color:var(--ds-muted)]">
                  {assignment.reviewerEmail}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Round</dt>
            <dd className="mt-1">{assignment.round}</dd>
          </div>
          <div>
            <dt className="font-semibold">Specialist dimension</dt>
            <dd className="mt-1">
              {assignment.specialistDimension ?? "Standard language review"}
            </dd>
          </div>
        </dl>
      </header>

      <OperatorAssignmentEvidence assignmentId={assignment.id} />

      <section className={PANEL} aria-labelledby="operator-human-evidence">
        <div className="flex items-center gap-2">
          <UserRound aria-hidden="true" size={18} />
          <h2 className="text-xl font-semibold" id="operator-human-evidence">
            Append-only human evidence
          </h2>
        </div>
        <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
          Raw blind Track A/B assessments are shown separately from the
          candidate-derived compatibility projection. Operator provenance is
          server-derived after submission.
        </p>
        <div className="mt-4 grid gap-4">
          {reviewEvidence.map((review) => (
            <OperatorReviewCard key={review.id} review={review} />
          ))}
          {reviewEvidence.length === 0 ? (
            <p className="text-sm text-[color:var(--ds-muted)]">
              No submitted human review versions.
            </p>
          ) : null}
        </div>
      </section>

      <section className={PANEL} aria-labelledby="operator-machine-evidence">
        <div className="flex items-center gap-2">
          <Bot aria-hidden="true" size={18} />
          <h2 className="text-xl font-semibold" id="operator-machine-evidence">
            Separate machine advisory evidence
          </h2>
        </div>
        <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
          Machine metrics never count as human, specialist, or gold approval.
        </p>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="font-semibold">Assessment digest</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {stringValue(machine?.assessmentDigest) ?? "Not retained"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Resolved model</dt>
            <dd className="mt-1">
              {stringValue(machine?.resolvedModel) ?? "Not reported"}
            </dd>
          </div>
        </dl>
      </section>
    </section>
  )
}

export function OperatorReviewCard({
  review,
}: {
  review: OperatorReviewEvidence
}) {
  const trackALabel = provenanceLabel("A", review)
  const trackBLabel = provenanceLabel("B", review)
  return (
    <article className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <strong className="flex items-center gap-2">
          <FileCheck2 aria-hidden="true" size={16} /> {review.verdict}
        </strong>
        <span className="text-xs text-[color:var(--ds-muted)]">
          {review.submittedAt ?? "Submission time unavailable"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <AssessmentCard
          assessment={review.trackA}
          label={`Raw Track A${trackALabel ? ` · ${trackALabel}` : ""}`}
        />
        <AssessmentCard
          assessment={review.trackB}
          label={`Raw Track B${trackBLabel ? ` · ${trackBLabel}` : ""}`}
        />
        <AssessmentCard
          assessment={review.candidateProjection}
          label="Candidate-derived compatibility projection (not raw A/B)"
        />
      </div>
      {review.questionableTrack ? (
        <p className="mt-3 text-sm">
          <strong>Questioned track:</strong> Track {review.questionableTrack} ·{" "}
          {review.questionableRole === "HUMAN_REFERENCE"
            ? "Human reference"
            : review.questionableRole === "AI_CANDIDATE"
              ? "AI candidate"
              : "provenance mapping unavailable"}
        </p>
      ) : null}
      {!review.trackA || !review.trackB ? (
        <p className="mt-3 text-xs text-[color:var(--ds-muted)]">
          This legacy review projection does not retain raw A/B assessments.
          Candidate-derived scalar scores are not relabeled as Track A or Track
          B.
        </p>
      ) : null}
      {review.notes ? (
        <section className="mt-4 rounded-[var(--ds-radius)] bg-[color:var(--ds-hover)] p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide">
            Reviewer notes
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">
            {review.notes}
          </p>
        </section>
      ) : null}
      {review.corrections.length > 0 ? (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide">
            Suggested segment corrections
          </h3>
          <ul className="mt-2 grid gap-2 text-sm">
            {review.corrections.map((correction, index) => (
              <li
                className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-3"
                key={`${correction.segmentId}:${correction.track}:${index}`}
              >
                <strong>
                  {correction.segmentId} · Track {correction.track}
                </strong>
                <span className="mt-1 block whitespace-pre-wrap" dir="auto">
                  {correction.text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

function AssessmentCard({
  assessment,
  label,
}: {
  assessment: Partial<BlindAssessment> | null
  label: string
}) {
  const criticalFlags = assessment
    ? [
        assessment.criticalMeaningLoss ? "Critical meaning loss" : null,
        assessment.criticalHarmful ? "Critical harmful content" : null,
        assessment.criticalScriptureRisk ? "Critical scripture risk" : null,
      ].filter((flag): flag is string => flag != null)
    : []
  return (
    <section className="rounded-[var(--ds-radius)] bg-[color:var(--ds-hover)] p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide">{label}</h3>
      {assessment ? (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt>Meaning</dt>
              <dd>{assessment.meaningAccuracyScore ?? "—"}</dd>
            </div>
            <div>
              <dt>Naturalness</dt>
              <dd>{assessment.naturalnessScore ?? "—"}</dd>
            </div>
            <div>
              <dt>Timing/readability</dt>
              <dd>{assessment.timingReadabilityScore ?? "—"}</dd>
            </div>
            <div>
              <dt>Scripture/theology</dt>
              <dd>{assessment.scriptureTheologyScore ?? "—"}</dd>
            </div>
          </dl>
          {(assessment.issueCodes?.length ?? 0) > 0 ? (
            <p className="mt-3 text-xs">
              <strong>Issues:</strong> {assessment.issueCodes?.join(", ")}
            </p>
          ) : null}
          {criticalFlags.length > 0 ? (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">
              <strong>Critical flags:</strong> {criticalFlags.join(", ")}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-[color:var(--ds-muted)]">
          Not retained
        </p>
      )}
    </section>
  )
}

function provenanceLabel(track: "A" | "B", review: OperatorReviewEvidence) {
  if (review.referenceTrackLabel === track) return "Human reference"
  if (review.candidateTrackLabel === track) return "AI candidate"
  return null
}

export function presentOperatorReviewEvidence(
  value: unknown,
): OperatorReviewEvidence[] {
  const assignment = record(value)
  if (!assignment || !Array.isArray(assignment.reviews)) return []
  const assignmentReference = trackLabel(assignment.referenceTrackLabel)
  const assignmentCandidate = trackLabel(assignment.candidateTrackLabel)
  return assignment.reviews.slice(0, 100).flatMap((rawReview, index) => {
    const review = record(rawReview)
    if (!review) return []
    const assessments = record(review.trackAssessments)
    const referenceTrackLabel =
      trackLabel(review.referenceTrackLabel) ?? assignmentReference
    const candidateTrackLabel =
      trackLabel(review.candidateTrackLabel) ?? assignmentCandidate
    const questionableTrack = trackLabel(review.questionableTrack)
    return [
      {
        id: stringValue(review.id) ?? `review-${index + 1}`,
        verdict: stringValue(review.verdict) ?? "UNKNOWN",
        submittedAt: stringValue(review.submittedAt),
        referenceTrackLabel,
        candidateTrackLabel,
        questionableTrack,
        questionableRole:
          questionableTrack == null
            ? null
            : questionableTrack === referenceTrackLabel
              ? "HUMAN_REFERENCE"
              : questionableTrack === candidateTrackLabel
                ? "AI_CANDIDATE"
                : "UNKNOWN",
        notes:
          typeof review.notes === "string"
            ? review.notes.slice(0, 4_000)
            : null,
        corrections: corrections(review.corrections),
        trackA: blindAssessment(assessments?.trackA),
        trackB: blindAssessment(assessments?.trackB),
        candidateProjection: candidateProjection(review),
      },
    ]
  })
}

function blindAssessment(value: unknown): BlindAssessment | null {
  const item = record(value)
  const meaningAccuracyScore = score(item?.meaningAccuracyScore)
  const naturalnessScore = score(item?.naturalnessScore)
  const timingReadabilityScore = score(item?.timingReadabilityScore)
  if (
    meaningAccuracyScore == null ||
    naturalnessScore == null ||
    timingReadabilityScore == null
  )
    return null
  return {
    meaningAccuracyScore,
    naturalnessScore,
    timingReadabilityScore,
    scriptureTheologyScore: score(item?.scriptureTheologyScore),
    issueCodes: Array.isArray(item?.issueCodes)
      ? item.issueCodes
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 14)
      : [],
    criticalMeaningLoss: item?.criticalMeaningLoss === true,
    criticalHarmful: item?.criticalHarmful === true,
    criticalScriptureRisk: item?.criticalScriptureRisk === true,
  }
}

function candidateProjection(
  value: Record<string, unknown>,
): OperatorReviewEvidence["candidateProjection"] {
  const meaningAccuracyScore = score(value.meaningAccuracyScore)
  const naturalnessScore = score(value.naturalnessScore)
  const timingReadabilityScore = score(value.timingReadabilityScore)
  if (
    meaningAccuracyScore == null ||
    naturalnessScore == null ||
    timingReadabilityScore == null
  )
    return null
  return {
    meaningAccuracyScore,
    naturalnessScore,
    timingReadabilityScore,
    scriptureTheologyScore: score(value.scriptureTheologyScore),
    issueCodes: Array.isArray(value.issueCodes)
      ? value.issueCodes
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 14)
      : [],
    criticalMeaningLoss: value.criticalMeaningLoss === true,
    criticalHarmful: value.criticalHarmful === true,
    criticalScriptureRisk: value.criticalScriptureRisk === true,
  }
}

function corrections(value: unknown): OperatorReviewEvidence["corrections"] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((entry) => {
    const correction = record(entry)
    const segmentId = stringValue(correction?.segmentId)
    const track = trackLabel(correction?.track)
    const text = stringValue(correction?.text)
    return segmentId && track && text != null
      ? [
          {
            segmentId: segmentId.slice(0, 200),
            track,
            text: text.slice(0, 1_000),
          },
        ]
      : []
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null
}

function trackLabel(value: unknown): "A" | "B" | null {
  return value === "A" || value === "B" ? value : null
}

function score(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
    ? value
    : null
}
