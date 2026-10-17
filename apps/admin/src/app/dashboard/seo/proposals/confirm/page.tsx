// feat-716 — Admin-origin confirmation for a Watch SEO opportunity.
//
// Watch opens this page with the proposal id, immutable version, payload
// digest, and the chosen action. Nothing is decided on GET. The Admin reads
// what Apply would create (an editorial draft or an engineering ticket — never
// a publish or deploy) and confirms or declines through a server action that
// re-checks the live Admin role.

import type { Route } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  DashboardPageHeader,
  PageSection,
  PrimaryButton,
  StatusPill,
} from "@/components/admin-ui"
import { requireLiveAdminSession } from "@/auth/live-admin-session"
import { prisma } from "@/db/client"
import { ForbiddenError } from "@/services/errors"
import {
  ADMIN_SEO_DECLINE_REASON_MIN_LENGTH,
  SeoExperimentService,
  type AdminSeoProposalConfirmation,
} from "@/services/seo-experiment.service"
import { confirmSeoProposalDecision } from "./actions"
import {
  confirmationHref,
  parseConfirmationIdentity,
  parseConfirmationResult,
  type ConfirmationIdentity,
  type ConfirmationResult,
} from "./confirmation-params"

export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

const RESULT_COPY: Record<
  ConfirmationResult,
  { tone: "success" | "warning" | "danger"; text: string }
> = {
  APPROVED: {
    tone: "success",
    text: "Applied. A draft or ticket was created; nothing was published or deployed.",
  },
  REJECTED: { tone: "success", text: "Declined. The decision is recorded." },
  STALE: {
    tone: "warning",
    text: "The page changed since this proposal was made. It was marked stale; regenerate it before deciding.",
  },
  CONFLICT: {
    tone: "warning",
    text: "Overlapping work or an existing draft blocks this decision. Acknowledge the overlap or resolve the draft first.",
  },
  ALREADY_DECIDED: {
    tone: "warning",
    text: "This proposal was already decided or replaced by a newer version.",
  },
  EXPIRED: {
    tone: "warning",
    text: "This proposal expired and must be regenerated.",
  },
  MISMATCH: {
    tone: "danger",
    text: "This link does not match the current proposal version. Nothing was changed.",
  },
  REPLAY: {
    tone: "danger",
    text: "This confirmation was already used. Nothing was changed.",
  },
  REASON_REQUIRED: {
    tone: "warning",
    text: `Declining needs a reason of at least ${ADMIN_SEO_DECLINE_REASON_MIN_LENGTH} characters.`,
  },
  INVALID: {
    tone: "danger",
    text: "This confirmation link is incomplete or invalid. Nothing was changed.",
  },
  RETRY: {
    tone: "warning",
    text: "Another change landed at the same time. Review the proposal and try again.",
  },
  ERROR: {
    tone: "danger",
    text: "The decision could not be recorded. Nothing was changed.",
  },
}

function ResultNotice({ result }: { result: ConfirmationResult }) {
  const copy = RESULT_COPY[result]
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-2">
      <StatusPill tone={copy.tone}>{result.replace("_", " ")}</StatusPill>
      <p className="text-[13px]">{copy.text}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-text">{label}</dt>
      <dd className="mt-0.5 text-[13px] break-words">{value}</dd>
    </div>
  )
}

function blockedReason(proposal: AdminSeoProposalConfirmation): string | null {
  if (proposal.decision) {
    return proposal.decision.action === "APPROVE"
      ? "This proposal version was already applied."
      : "This proposal version was already declined."
  }
  if (proposal.currentVersion !== proposal.version) {
    return "A newer version of this proposal exists. Open it from Watch again."
  }
  if (proposal.proposalStatus !== "PROPOSED") {
    return `This proposal is ${proposal.proposalStatus.toLowerCase()} and can no longer be decided.`
  }
  if (new Date(proposal.expiresAt).getTime() <= Date.now()) {
    return "This proposal expired and must be regenerated."
  }
  return null
}

function DecisionForm({
  identity,
  proposal,
  result,
}: {
  identity: ConfirmationIdentity
  proposal: AdminSeoProposalConfirmation
  result: ConfirmationResult | null
}) {
  const apply = identity.decision === "apply"
  const showOverlap =
    apply && (proposal.overlapCount > 0 || result === "CONFLICT")
  return (
    <form action={confirmSeoProposalDecision} className="flex flex-col gap-3">
      <input type="hidden" name="proposalId" value={identity.proposalId} />
      <input type="hidden" name="version" value={String(identity.version)} />
      <input
        type="hidden"
        name="payloadDigest"
        value={identity.payloadDigest}
      />
      <input type="hidden" name="decision" value={identity.decision} />
      {apply ? (
        <p className="text-[13px]">
          {proposal.applyCreates === "editorial_draft"
            ? "Apply creates an editorial draft for review in the editor. Canonical content stays unchanged until someone publishes the draft."
            : "Apply queues an engineering ticket. Nothing is deployed, and a queued ticket cannot be retracted."}{" "}
          It never publishes or deploys.
        </p>
      ) : (
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="label-text">
            Reason for declining (at least {ADMIN_SEO_DECLINE_REASON_MIN_LENGTH}{" "}
            characters)
          </span>
          <textarea
            name="reason"
            required
            minLength={ADMIN_SEO_DECLINE_REASON_MIN_LENGTH}
            maxLength={2000}
            rows={3}
            className="rounded-sm border border-[var(--color-hairline)] p-2"
          />
        </label>
      )}
      {showOverlap ? (
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="overlapAcknowledged" value="yes" />
          <span>
            I understand {proposal.overlapCount || "some"} other active
            change(s) target the same page and may confound the result.
          </span>
        </label>
      ) : null}
      <div className="flex items-center gap-3">
        <PrimaryButton type="submit">
          {apply
            ? proposal.applyCreates === "editorial_draft"
              ? "Apply — create draft"
              : "Apply — queue ticket"
            : "Decline proposal"}
        </PrimaryButton>
        <Link
          className="text-[13px] underline"
          href={
            confirmationHref({
              ...identity,
              decision: apply ? "decline" : "apply",
            }) as Route
          }
        >
          {apply ? "Decline instead" : "Apply instead"}
        </Link>
      </div>
    </form>
  )
}

export default async function SeoProposalConfirmPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { actorId } = await requireLiveAdminSession()
  const params = await searchParams
  const result = parseConfirmationResult(params.result)
  const identity = parseConfirmationIdentity(params)

  const header = (
    <DashboardPageHeader
      eyebrow="SEO"
      title="Confirm SEO proposal decision"
      description="Decisions are recorded against this exact proposal version. Nothing here publishes or deploys."
    />
  )

  if (!identity) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ResultNotice result="INVALID" />
      </div>
    )
  }

  let proposal: AdminSeoProposalConfirmation | null
  try {
    proposal = await new SeoExperimentService(
      prisma,
    ).readProposalForAdminConfirmation({
      actorId,
      proposalId: identity.proposalId,
      version: identity.version,
    })
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/dashboard")
    throw error
  }

  if (!proposal || proposal.payloadDigest !== identity.payloadDigest) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ResultNotice result="MISMATCH" />
      </div>
    )
  }

  const blocked = blockedReason(proposal)

  return (
    <div className="flex flex-col gap-6">
      {header}
      {result ? <ResultNotice result={result} /> : null}
      <PageSection
        title={identity.decision === "apply" ? "Apply" : "Decline"}
        meta={`Proposal ${proposal.proposalId} · version ${proposal.version}`}
      >
        <div className="p-4">
          <dl className="grid gap-3 md:grid-cols-2">
            <Detail label="Current status" value={proposal.proposalStatus} />
            <Detail
              label="Apply creates"
              value={
                proposal.applyCreates === "editorial_draft"
                  ? "Editorial draft (not published)"
                  : "Engineering ticket (not deployed)"
              }
            />
            <Detail label="Page" value={proposal.canonicalUrl} />
            <Detail label="Locale" value={proposal.locale} />
            <Detail label="Intent" value={proposal.intent} />
            <Detail label="Expected outcome" value={proposal.expectedOutcome} />
            <Detail label="Risk" value={proposal.risk} />
            <Detail
              label="Changes"
              value={proposal.affectedFields.join(", ") || "—"}
            />
            <Detail
              label="Verification plan"
              value={proposal.verificationPlan}
            />
            <Detail label="Rollback plan" value={proposal.rollbackPlan} />
            <Detail label="Expires" value={proposal.expiresAt} />
            <Detail label="Payload digest" value={proposal.payloadDigest} />
          </dl>
          {proposal.caveats.length > 0 ? (
            <ul className="mt-3 list-disc pl-5 text-[13px]">
              {proposal.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          ) : null}
          {proposal.materialization?.editorPath?.startsWith("/") ? (
            <p className="mt-3 text-[13px]">
              <Link
                className="underline"
                href={proposal.materialization.editorPath as Route}
              >
                Open the draft in the editor
              </Link>
            </p>
          ) : null}
        </div>
      </PageSection>
      <PageSection title="Decision">
        <div className="p-4">
          {blocked ? (
            <p className="text-[13px]">{blocked}</p>
          ) : (
            <DecisionForm
              identity={identity}
              proposal={proposal}
              result={result}
            />
          )}
        </div>
      </PageSection>
    </div>
  )
}
