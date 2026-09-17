"use client"

import { Eye, ShieldCheck, UserPlus } from "lucide-react"
import { useMemo, useState, type FormEvent } from "react"

import { apiFetch } from "@/lib/api-fetch"

import { useStableActionKey } from "./stable-action-key"

import type {
  SubtitleLabAssignmentProgress,
  SubtitleLabReviewerCandidate,
  SubtitleLabRunCell,
} from "./subtitle-lab-operator-types"

const INPUT =
  "min-h-10 w-full rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel)] px-3 py-2 text-sm"
const BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--ds-radius)] border border-[color:var(--ds-line-strong)] bg-[color:var(--ds-panel)] px-3 py-2 text-sm font-semibold hover:bg-[color:var(--ds-hover)] disabled:opacity-45"

export function SubtitleAssignmentControl({
  assignments,
  cell,
  reviewerCandidates,
}: {
  assignments: SubtitleLabAssignmentProgress[]
  cell: SubtitleLabRunCell
  reviewerCandidates: SubtitleLabReviewerCandidate[]
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const assignmentActionKey = useStableActionKey()
  const cellAssignments = assignments.filter(
    (assignment) => assignment.runCellId === cell.id,
  )
  const exactCandidates = useMemo(
    () =>
      reviewerCandidates.filter(
        (candidate) =>
          candidate.targetLanguageId === cell.targetLanguageId &&
          candidate.targetLanguageSlug === cell.targetLanguageSlug,
      ),
    [cell.targetLanguageId, cell.targetLanguageSlug, reviewerCandidates],
  )

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage(null)
    const response = await apiFetch("/api/subtitle-lab/assignments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: assignmentActionKey.current(),
        runCellId: cell.id,
        reviewerMembershipId: String(form.get("reviewerMembershipId") ?? ""),
        kind: "STANDARD",
      }),
    }).catch(() => null)
    setBusy(false)
    if (response?.ok) assignmentActionKey.complete()
    setMessage(
      response?.ok
        ? "Assignment created. Reload to see current progress."
        : "Assignment was rejected. The reviewer grant may have changed.",
    )
  }

  async function assignSpecialist(
    event: FormEvent<HTMLFormElement>,
    assignment: SubtitleLabAssignmentProgress,
  ) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setMessage(null)
    const response = await apiFetch(
      `/api/subtitle-lab/assignments/${encodeURIComponent(assignment.id)}/specialist`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewerMembershipId: String(
            form.get("specialistReviewerMembershipId") ?? "",
          ),
        }),
      },
    ).catch(() => null)
    setBusy(false)
    setMessage(
      response?.ok
        ? "Qualified specialist assigned."
        : "Specialist assignment was rejected after fresh qualification checks.",
    )
  }

  return (
    <div className="grid gap-3">
      {cellAssignments.map((assignment) => {
        const specialistCandidates = exactCandidates.filter(
          (candidate) =>
            assignment.specialistDimension != null &&
            (assignment.specialistDimension === "SCRIPTURE_THEOLOGY"
              ? candidate.specialistCapabilities.includes("SCRIPTURE") ||
                candidate.specialistCapabilities.includes("THEOLOGY")
              : candidate.specialistCapabilities.includes(
                  assignment.specialistDimension,
                )),
        )
        return (
          <article
            className="rounded-[var(--ds-radius)] border border-[color:var(--ds-line)] p-3"
            key={assignment.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <strong>
                  {assignment.reviewerDisplayName || "Pending reviewer"}
                </strong>
                <p className="mt-0.5 text-xs text-[color:var(--ds-muted)]">
                  {assignment.kind} · round {assignment.round} ·{" "}
                  {assignment.status}
                </p>
              </div>
              <span className="rounded-full border border-[color:var(--ds-line-strong)] px-2 py-0.5 text-xs">
                {assignment.latestVerdict ?? "No verdict"}
              </span>
            </div>
            {assignment.reviewerEmail ? (
              <p className="mt-2 text-xs" dir="auto">
                {assignment.reviewerEmail}
              </p>
            ) : null}
            <a
              className={`${BUTTON} mt-3`}
              href={`/dashboard/subtitle-lab/assignments/${encodeURIComponent(assignment.id)}`}
            >
              <Eye aria-hidden="true" size={16} /> Open review evidence
            </a>
            {assignment.kind === "SPECIALIST" &&
            !assignment.reviewerMembershipId ? (
              <form
                className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]"
                onSubmit={(event) => assignSpecialist(event, assignment)}
              >
                <label className="text-xs font-semibold">
                  Qualified {assignment.specialistDimension ?? "specialist"}
                  <select
                    className={`${INPUT} mt-1`}
                    name="specialistReviewerMembershipId"
                    required
                  >
                    <option value="">
                      Select an exact-language specialist
                    </option>
                    {specialistCandidates.map((candidate) => (
                      <option
                        key={candidate.membershipId}
                        value={candidate.membershipId}
                      >
                        {candidate.displayName} ·{" "}
                        {candidate.activeAssignmentCount} active
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={`${BUTTON} self-end`}
                  disabled={busy || specialistCandidates.length === 0}
                  type="submit"
                >
                  <ShieldCheck aria-hidden="true" size={16} /> Assign specialist
                </button>
              </form>
            ) : null}
          </article>
        )
      })}

      {cell.status === "COMPLETED" ? (
        <form
          className="grid gap-2 rounded-[var(--ds-radius)] border border-dashed border-[color:var(--ds-line-strong)] p-3 md:grid-cols-[1fr_auto]"
          onSubmit={createAssignment}
        >
          <label className="text-xs font-semibold">
            Exact-language reviewer
            <select
              className={`${INPUT} mt-1`}
              name="reviewerMembershipId"
              required
            >
              <option value="">Select qualified reviewer</option>
              {exactCandidates.map((candidate) => (
                <option
                  key={candidate.membershipId}
                  value={candidate.membershipId}
                >
                  {candidate.displayName} · Qualification v
                  {candidate.qualificationVersion} ·{" "}
                  {candidate.activeAssignmentCount} active
                </option>
              ))}
            </select>
          </label>
          <button
            className={`${BUTTON} self-end`}
            disabled={busy || exactCandidates.length === 0}
            type="submit"
          >
            <UserPlus aria-hidden="true" size={16} /> Assign
          </button>
          {exactCandidates.length === 0 ? (
            <p className="text-xs text-[color:var(--ds-muted)] md:col-span-3">
              No active reviewer has this exact Language.id + Language.slug and
              all mandatory rubric qualifications.
            </p>
          ) : null}
          {assignmentActionKey.peek() ? (
            <details className="text-xs text-[color:var(--ds-muted)] md:col-span-2">
              <summary>Advanced retry evidence</summary>
              <code className="mt-1 block break-all">
                {assignmentActionKey.peek()}
              </code>
            </details>
          ) : null}
        </form>
      ) : null}
      {message ? (
        <p className="text-xs text-[color:var(--ds-muted)]" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
