"use client"

import {
  AlertTriangle,
  ArrowRight,
  Beaker,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  Code2,
  ExternalLink,
  FileDiff,
  Link2,
  ListChecks,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  TriangleAlert,
  type LucideIcon,
  X,
  XCircle,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api-fetch"
import {
  isSafeExternalUrl,
  type SeoCandidateTicket,
  type SeoEvidenceObservation,
  type SeoExperiment,
  type SeoLesson,
  type SeoProposal,
  type SeoProposalDecisionResult,
  type SeoTicketReconciliation,
  type SeoWorkspace,
  type SeoWorkspaceView,
} from "./seo-contract"
import { SEO_WORKSPACE_VIEW_META, SeoWorkspaceTabs } from "./seo-workspace-tabs"
import {
  buildSeoOverviewQueue,
  formatSeoDate,
  formatSeoMetricValue,
  getProposalLifecycleState,
  presentDecisionResult,
  presentSeoExperiment,
  presentSeoProposal,
  sortSeoEvidence,
  summarizeProviders,
  type SeoTone,
} from "./seo-presenter"

type WorkspaceProps = {
  initialWorkspace: SeoWorkspace
  initialView: SeoWorkspaceView
  initialCsrfToken: string
  readOnlyReason?: string
  loadError?: string
  isDemo: boolean
}

type ProposalActionState =
  | { kind: "idle" }
  | { kind: "confirm_approve" }
  | { kind: "confirm_reject" }
  | { kind: "submitting"; action: "approve" | "reject" }
  | { kind: "success"; result: SeoProposalDecisionResult }
  | { kind: "error"; message: string; retryable: boolean }

const TONE_ICONS: Record<SeoTone, LucideIcon> = {
  danger: XCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  neutral: CircleDashed,
}

const OVERVIEW_ICONS = {
  rollback: RotateCcw,
  reconciliation: Link2,
  blocked: ShieldAlert,
  proposal: ListChecks,
  exception: TriangleAlert,
} satisfies Record<string, LucideIcon>

function normalized(value: string): string {
  return value.trim().toUpperCase().replaceAll("-", "_")
}

function StatusBadge({ label, tone }: { label: string; tone: SeoTone }) {
  const Icon = TONE_ICONS[tone]
  return (
    <span className={`seo-status-badge is-${tone}`}>
      <Icon aria-hidden="true" size={15} />
      <span>{label}</span>
    </span>
  )
}

function ProposalStatus({ proposal }: { proposal: SeoProposal }) {
  const presentation = presentSeoProposal(proposal)
  return <StatusBadge label={presentation.label} tone={presentation.tone} />
}

function safeTextLink(url: string | undefined, label: string) {
  if (!isSafeExternalUrl(url)) return null
  return (
    <a href={url} rel="noreferrer" target="_blank">
      {label}
      <ExternalLink aria-hidden="true" size={14} />
    </a>
  )
}

function ProposalQueue({
  proposals,
  selectedId,
  onSelect,
}: {
  proposals: SeoProposal[]
  selectedId?: string
  onSelect: (id: string) => void
}) {
  if (proposals.length === 0) {
    return (
      <div className="seo-empty-state">
        <SearchCheck aria-hidden="true" size={24} />
        <strong>No proposals in this bounded snapshot</strong>
        <p>
          Missing rows are not zero. Check the run and provider states before
          concluding there were no opportunities.
        </p>
      </div>
    )
  }

  return (
    <div className="seo-proposal-queue" aria-label="Proposal queue">
      {proposals.map((proposal) => (
        <button
          type="button"
          key={`${proposal.id}:${proposal.version}`}
          className={selectedId === proposal.id ? "is-selected" : undefined}
          aria-current={selectedId === proposal.id ? "true" : undefined}
          onClick={() => onSelect(proposal.id)}
        >
          <span className="seo-queue-row-topline">
            <span className="seo-queue-lane">{proposal.lane}</span>
            <ProposalStatus proposal={proposal} />
          </span>
          <strong dir="auto">{proposal.intent}</strong>
          <span className="seo-queue-meta">
            {proposal.locale} · v{proposal.version} · {proposal.targetType}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="seo-queue-chevron"
            size={18}
          />
        </button>
      ))}
    </div>
  )
}

function EditorialDiff({ proposal }: { proposal: SeoProposal }) {
  if (proposal.editorialDiff.length === 0) return null
  return (
    <section className="seo-detail-section" aria-labelledby="seo-diff-title">
      <div className="seo-section-heading">
        <div>
          <span className="seo-section-eyebrow">Immutable treatment</span>
          <h3 id="seo-diff-title">Exact editorial diff</h3>
        </div>
        <FileDiff aria-hidden="true" size={21} />
      </div>
      <div
        className="seo-diff-table"
        role="table"
        aria-label="Editorial field changes"
      >
        <div className="seo-diff-row seo-diff-header" role="row">
          <span role="columnheader">Field</span>
          <span role="columnheader">Current</span>
          <span role="columnheader">Proposed</span>
        </div>
        {proposal.editorialDiff.map((diff) => (
          <div className="seo-diff-row" role="row" key={diff.field}>
            <strong role="rowheader" dir="auto">
              {diff.field}
            </strong>
            <div
              role="cell"
              className="seo-diff-before"
              aria-label={`${diff.field}, current`}
            >
              <span aria-hidden="true">−</span>
              <p dir="auto">{diff.before}</p>
            </div>
            <div
              role="cell"
              className="seo-diff-after"
              aria-label={`${diff.field}, proposed`}
            >
              <span aria-hidden="true">+</span>
              <p dir="auto">{diff.after}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function EngineeringBrief({ proposal }: { proposal: SeoProposal }) {
  const brief = proposal.engineeringBrief
  if (!brief) return null
  return (
    <section className="seo-detail-section" aria-labelledby="seo-brief-title">
      <div className="seo-section-heading">
        <div>
          <span className="seo-section-eyebrow">Immutable ticket payload</span>
          <h3 id="seo-brief-title">Engineering brief</h3>
        </div>
        <Code2 aria-hidden="true" size={21} />
      </div>
      <div className="seo-brief-card">
        <h4 dir="auto">{brief.title}</h4>
        <p dir="auto">{brief.problem}</p>
        <h5>Acceptance criteria</h5>
        <ul>
          {brief.acceptanceCriteria.map((criterion) => (
            <li key={criterion} dir="auto">
              <Check aria-hidden="true" size={15} />
              <span>{criterion}</span>
            </li>
          ))}
        </ul>
        {brief.deploymentProbe ? (
          <dl className="seo-probe-grid">
            <div>
              <dt>Activation probe</dt>
              <dd>{brief.deploymentProbe.kind}</dd>
            </div>
            <div>
              <dt>Expected observation</dt>
              <dd dir="auto">{brief.deploymentProbe.expected}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd dir="auto">{brief.deploymentProbe.target}</dd>
            </div>
            <div>
              <dt>Canonicalization</dt>
              <dd>
                {brief.deploymentProbe.canonicalizationVersion ??
                  "Not reported"}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="seo-inline-warning">
            <TriangleAlert aria-hidden="true" size={17} />
            <p>
              Ticket-only: no objective deployment probe is registered, so this
              work cannot activate an experiment or produce a lesson.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function EvidenceRow({ evidence }: { evidence: SeoEvidenceObservation }) {
  const tone: SeoTone =
    evidence.status === "AVAILABLE"
      ? "success"
      : evidence.status === "UNAVAILABLE"
        ? "danger"
        : "warning"
  return (
    <article className="seo-evidence-row">
      <div className="seo-evidence-header">
        <strong>{evidence.provider.replaceAll("_", " ")}</strong>
        <StatusBadge label={evidence.status.toLowerCase()} tone={tone} />
      </div>
      <p dir="auto">{evidence.summary}</p>
      <dl>
        <div>
          <dt>Observed</dt>
          <dd>{formatSeoDate(evidence.retrievedAt)}</dd>
        </div>
        {evidence.quality ? (
          <div>
            <dt>Data state</dt>
            <dd>{evidence.quality}</dd>
          </div>
        ) : null}
      </dl>
      {evidence.coverage ? (
        <p className="seo-evidence-caveat" dir="auto">
          {evidence.coverage}
        </p>
      ) : null}
      {safeTextLink(evidence.sourceUrl, "Open retained source")}
    </article>
  )
}

function ProposalEvidence({ proposal }: { proposal: SeoProposal }) {
  return (
    <section
      className="seo-detail-section"
      aria-labelledby="seo-evidence-title"
    >
      <div className="seo-section-heading">
        <div>
          <span className="seo-section-eyebrow">Evidence hierarchy</span>
          <h3 id="seo-evidence-title">Why this action exists</h3>
        </div>
        <SearchCheck aria-hidden="true" size={21} />
      </div>
      {proposal.evidence.length === 0 ? (
        <div className="seo-empty-state is-compact">
          <TriangleAlert aria-hidden="true" size={20} />
          <strong>No retained evidence observations</strong>
          <p>
            Do not approve a recommendation whose primary evidence is
            unavailable.
          </p>
        </div>
      ) : (
        <div className="seo-evidence-list">
          {sortSeoEvidence(proposal.evidence).map((evidence) => (
            <EvidenceRow evidence={evidence} key={evidence.id} />
          ))}
        </div>
      )}
      {proposal.caveats.length > 0 ? (
        <div className="seo-caveat-box">
          <TriangleAlert aria-hidden="true" size={18} />
          <div>
            <strong>Coverage and attribution caveats</strong>
            <ul>
              {proposal.caveats.map((caveat) => (
                <li key={caveat} dir="auto">
                  {caveat}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ProposalDecisionPanel({
  proposal,
  csrfToken,
  setCsrfToken,
  readOnlyReason,
  onResult,
}: {
  proposal: SeoProposal
  csrfToken: string
  setCsrfToken: (value: string) => void
  readOnlyReason?: string
  onResult: (result: SeoProposalDecisionResult) => void
}) {
  const [state, setState] = useState<ProposalActionState>({ kind: "idle" })
  const [overlapAcknowledged, setOverlapAcknowledged] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const statusRef = useRef<HTMLDivElement | null>(null)
  const confirmationRef = useRef<HTMLHeadingElement | null>(null)
  const presentation = presentSeoProposal(proposal)
  const requiresOverlapAcknowledgement = proposal.overlapCount > 0

  useEffect(() => {
    if (state.kind === "confirm_approve" || state.kind === "confirm_reject") {
      confirmationRef.current?.focus()
    }
    if (state.kind === "success" || state.kind === "error") {
      statusRef.current?.focus()
    }
  }, [state.kind])

  async function submit(action: "approve" | "reject") {
    setState({ kind: "submitting", action })
    try {
      const response = await apiFetch(
        `/api/seo/proposals/${encodeURIComponent(proposal.id)}/${action}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-seo-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            version: proposal.version,
            payloadDigest: proposal.payloadDigest,
            overlapAcknowledged,
            ...(action === "reject" ? { reason: rejectionReason } : {}),
          }),
        },
      )
      const payload = (await response.json()) as {
        result?: SeoProposalDecisionResult
        error?: string
        retryable?: boolean
        nextCsrfToken?: string
      }
      if (payload.nextCsrfToken) setCsrfToken(payload.nextCsrfToken)
      if (!response.ok || !payload.result) {
        setState({
          kind: "error",
          message: payload.error ?? "The decision did not complete.",
          retryable: payload.retryable === true,
        })
        return
      }
      setState({ kind: "success", result: payload.result })
      onResult(payload.result)
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The decision did not complete.",
        retryable: true,
      })
    }
  }

  const isSubmitting = state.kind === "submitting"
  const resultPresentation =
    state.kind === "success" ? presentDecisionResult(state.result) : null

  return (
    <section
      className="seo-decision-panel"
      aria-labelledby="seo-decision-title"
    >
      <div className="seo-section-heading">
        <div>
          <span className="seo-section-eyebrow">Human authority</span>
          <h3 id="seo-decision-title">Decision and recovery</h3>
        </div>
        <ShieldCheck aria-hidden="true" size={21} />
      </div>

      <div className={`seo-recovery-guidance is-${presentation.tone}`}>
        <StatusBadge label={presentation.label} tone={presentation.tone} />
        <strong>{presentation.nextAction}</strong>
        <p>{presentation.guidance}</p>
      </div>

      {readOnlyReason ? (
        <div className="seo-inline-warning">
          <ShieldAlert aria-hidden="true" size={18} />
          <div>
            <strong>Read-only workspace</strong>
            <p>{readOnlyReason}</p>
          </div>
        </div>
      ) : null}

      {requiresOverlapAcknowledgement && presentation.canApprove ? (
        <label className="seo-overlap-acknowledgement">
          <input
            type="checkbox"
            checked={overlapAcknowledged}
            onChange={(event) => setOverlapAcknowledged(event.target.checked)}
          />
          <span>
            <strong>
              I reviewed {proposal.overlapCount} overlapping change
              {proposal.overlapCount === 1 ? "" : "s"}
            </strong>
            <small>
              Approval records this acknowledgement as an evaluation confounder;
              it does not erase the overlap.
            </small>
          </span>
        </label>
      ) : null}

      {state.kind === "confirm_approve" || state.kind === "confirm_reject" ? (
        <div
          className="seo-confirmation"
          role="group"
          aria-labelledby="seo-confirmation-title"
        >
          <h4 id="seo-confirmation-title" ref={confirmationRef} tabIndex={-1}>
            {state.kind === "confirm_approve"
              ? "Approve this exact immutable version?"
              : "Reject this exact immutable version?"}
          </h4>
          <p>
            v{proposal.version} · digest <code>{proposal.payloadDigest}</code>
          </p>
          {state.kind === "confirm_reject" ? (
            <label>
              <span>Reason for future reviewers</span>
              <textarea
                rows={3}
                maxLength={2_000}
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
              />
            </label>
          ) : null}
          <div className="seo-action-row">
            <button
              type="button"
              className="seo-primary-button"
              disabled={
                isSubmitting ||
                (state.kind === "confirm_reject" &&
                  rejectionReason.trim().length < 3)
              }
              onClick={() =>
                void submit(
                  state.kind === "confirm_approve" ? "approve" : "reject",
                )
              }
            >
              <ShieldCheck aria-hidden="true" size={17} />
              Confirm{" "}
              {state.kind === "confirm_approve" ? "approval" : "rejection"}
            </button>
            <button
              type="button"
              className="seo-secondary-button"
              onClick={() => setState({ kind: "idle" })}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {state.kind === "idle" ? (
        <div className="seo-action-row" id="seo-proposal-actions">
          {presentation.canApprove ? (
            <button
              type="button"
              className="seo-primary-button"
              disabled={
                Boolean(readOnlyReason) ||
                (requiresOverlapAcknowledgement && !overlapAcknowledged)
              }
              onClick={() => setState({ kind: "confirm_approve" })}
            >
              <Check aria-hidden="true" size={17} />
              Approve exact version
            </button>
          ) : null}
          {presentation.canReject ? (
            <button
              type="button"
              className="seo-secondary-button"
              disabled={Boolean(readOnlyReason)}
              onClick={() => setState({ kind: "confirm_reject" })}
            >
              <X aria-hidden="true" size={17} />
              Reject
            </button>
          ) : null}
          {proposal.materialization?.editorPath ? (
            <a
              className="seo-secondary-button"
              href={proposal.materialization.editorPath}
            >
              Open Admin draft
              <ExternalLink aria-hidden="true" size={15} />
            </a>
          ) : null}
          {proposal.materialization?.remoteUrl
            ? safeTextLink(
                proposal.materialization.remoteUrl,
                "Open delivered ticket",
              )
            : null}
        </div>
      ) : null}

      {isSubmitting ? (
        <div className="seo-mutation-status" role="status" aria-live="polite">
          <RefreshCw aria-hidden="true" className="is-spinning" size={18} />
          <span>
            {state.action === "approve" ? "Approving" : "Rejecting"} immutable
            version…
          </span>
        </div>
      ) : null}

      {state.kind === "success" && resultPresentation ? (
        <div
          className={`seo-mutation-status is-${resultPresentation.tone}`}
          role="status"
          aria-live="polite"
          ref={statusRef}
          tabIndex={-1}
        >
          <CheckCircle2 aria-hidden="true" size={18} />
          <div>
            <strong>{resultPresentation.label}</strong>
            <p>{state.result.message ?? resultPresentation.guidance}</p>
            {state.result.editorPath ? (
              <a href={state.result.editorPath}>
                Open Admin draft review
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div
          className="seo-mutation-status is-danger"
          role="alert"
          ref={statusRef}
          tabIndex={-1}
        >
          <XCircle aria-hidden="true" size={18} />
          <div>
            <strong>
              {state.retryable ? "Temporary failure" : "Action unavailable"}
            </strong>
            <p>{state.message}</p>
            <p>
              {state.retryable
                ? "Confirm the proposal is still current before retrying once."
                : "Do not work around this with a service key or direct content mutation."}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ProposalDetail({
  proposal,
  csrfToken,
  setCsrfToken,
  readOnlyReason,
  onResult,
}: {
  proposal: SeoProposal
  csrfToken: string
  setCsrfToken: (value: string) => void
  readOnlyReason?: string
  onResult: (result: SeoProposalDecisionResult) => void
}) {
  return (
    <article className="seo-proposal-detail">
      <header className="seo-detail-hero">
        <div className="seo-detail-hero-topline">
          <ProposalStatus proposal={proposal} />
          <span>{proposal.lane}</span>
          <span>{proposal.locale}</span>
          <span>v{proposal.version}</span>
        </div>
        <h2 dir="auto">{proposal.intent}</h2>
        <p className="seo-canonical" dir="ltr">
          {proposal.canonicalUrl}
        </p>
        <dl className="seo-detail-summary-grid">
          <div>
            <dt>Expected result</dt>
            <dd dir="auto">{proposal.expectedOutcome}</dd>
          </div>
          <div>
            <dt>Risk</dt>
            <dd dir="auto">{proposal.risk}</dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd dir="auto">{proposal.verificationPlan}</dd>
          </div>
          <div>
            <dt>Rollback</dt>
            <dd dir="auto">{proposal.rollbackPlan}</dd>
          </div>
        </dl>
      </header>
      <ProposalDecisionPanel
        key={`${proposal.id}:${proposal.version}`}
        proposal={proposal}
        csrfToken={csrfToken}
        setCsrfToken={setCsrfToken}
        readOnlyReason={readOnlyReason}
        onResult={onResult}
      />
      <EditorialDiff proposal={proposal} />
      <EngineeringBrief proposal={proposal} />
      <ProposalEvidence proposal={proposal} />
      <section
        className="seo-detail-section seo-audit-strip"
        aria-label="Audit identity"
      >
        <div>
          <span>Proposal</span>
          <code>{proposal.id}</code>
        </div>
        <div>
          <span>Payload digest</span>
          <code>{proposal.payloadDigest}</code>
        </div>
        <div>
          <span>Expires</span>
          <strong>{formatSeoDate(proposal.expiresAt)}</strong>
        </div>
      </section>
    </article>
  )
}

function OverviewView({
  workspace,
  loadError,
  onNavigate,
}: {
  workspace: SeoWorkspace
  loadError?: string
  onNavigate: (view: SeoWorkspaceView, proposalId?: string) => void
}) {
  const queue = buildSeoOverviewQueue(workspace)
  const providers = summarizeProviders(workspace)
  const harmfulCount = workspace.experiments.filter(
    (experiment) => normalized(experiment.status) === "HARMFUL",
  ).length
  const proposedCount = workspace.proposals.filter(
    (proposal) => getProposalLifecycleState(proposal) === "PROPOSED",
  ).length
  const pendingLessons = workspace.lessons.filter(
    (lesson) => normalized(lesson.status) === "PENDING",
  ).length

  return (
    <div className="seo-view-stack">
      {loadError ? (
        <div className="seo-run-alert" role="status">
          <ShieldAlert aria-hidden="true" size={20} />
          <div>
            <strong>Admin SEO workspace unavailable</strong>
            <p>{loadError}</p>
            <p>No demo evidence has been substituted in Admin mode.</p>
          </div>
        </div>
      ) : null}

      <section
        className="seo-overview-priority"
        aria-labelledby="seo-priority-title"
      >
        <div className="seo-section-heading">
          <div>
            <span className="seo-section-eyebrow">Work in priority order</span>
            <h2 id="seo-priority-title">What needs an operator now</h2>
          </div>
          <Sparkles aria-hidden="true" size={22} />
        </div>
        {queue.length === 0 ? (
          <div className="seo-empty-state">
            <CheckCircle2 aria-hidden="true" size={24} />
            <strong>No retained operator actions</strong>
            <p>
              Review provider and run coverage before treating an empty queue as
              complete.
            </p>
          </div>
        ) : (
          <div className="seo-priority-list">
            {queue.map((item) => {
              const Icon = OVERVIEW_ICONS[item.kind]
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`is-${item.kind}`}
                  onClick={() => onNavigate(item.targetView, item.proposalId)}
                >
                  <span className="seo-priority-icon">
                    <Icon aria-hidden="true" size={19} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small dir="auto">{item.detail}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={18} />
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="seo-stat-grid" aria-label="SEO workspace totals">
        <button type="button" onClick={() => onNavigate("experiments")}>
          <span>Harmful outcomes</span>
          <strong>{harmfulCount}</strong>
          <small>Rollback remains approval-required</small>
        </button>
        <button type="button" onClick={() => onNavigate("reconciliation")}>
          <span>Manual reconciliation</span>
          <strong>{workspace.ticketReconciliations.length}</strong>
          <small>No automatic duplicate creation</small>
        </button>
        <button type="button" onClick={() => onNavigate("proposals")}>
          <span>Ready proposals</span>
          <strong>{proposedCount}</strong>
          <small>Exact immutable versions</small>
        </button>
        <button type="button" onClick={() => onNavigate("learnings")}>
          <span>Lessons to review</span>
          <strong>{pendingLessons}</strong>
          <small>Never activated automatically</small>
        </button>
      </section>

      <section
        className="seo-provider-section"
        aria-labelledby="seo-provider-title"
      >
        <div className="seo-section-heading">
          <div>
            <span className="seo-section-eyebrow">Latest retained run</span>
            <h2 id="seo-provider-title">Provider and coverage status</h2>
          </div>
          <span className="seo-generated-at">
            {formatSeoDate(workspace.generatedAt)}
          </span>
        </div>
        {providers.length === 0 ? (
          <div className="seo-empty-state is-compact">
            <CircleDashed aria-hidden="true" size={21} />
            <strong>No provider observations retained</strong>
            <p>
              Unavailable coverage remains unknown; it is not converted to zero.
            </p>
          </div>
        ) : (
          <div className="seo-provider-grid">
            {providers.map((provider) => {
              const tone: SeoTone =
                provider.status === "AVAILABLE"
                  ? "success"
                  : provider.status === "UNAVAILABLE"
                    ? "danger"
                    : "warning"
              return (
                <article key={provider.provider}>
                  <div>
                    <strong>{provider.label}</strong>
                    <StatusBadge
                      label={provider.status.toLowerCase()}
                      tone={tone}
                    />
                  </div>
                  <p dir="auto">{provider.note}</p>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function ProposalsView({
  workspace,
  selectedId,
  setSelectedId,
  csrfToken,
  setCsrfToken,
  readOnlyReason,
  onResult,
}: {
  workspace: SeoWorkspace
  selectedId?: string
  setSelectedId: (id: string) => void
  csrfToken: string
  setCsrfToken: (value: string) => void
  readOnlyReason?: string
  onResult: (result: SeoProposalDecisionResult) => void
}) {
  const proposal =
    workspace.proposals.find((candidate) => candidate.id === selectedId) ??
    workspace.proposals[0]
  return (
    <div className="seo-proposals-layout">
      <aside className="seo-queue-panel">
        <div className="seo-queue-panel-heading">
          <span className="seo-section-eyebrow">Shared review queue</span>
          <h2>Proposals</h2>
          <p>{workspace.proposals.length} bounded versions in this snapshot</p>
        </div>
        <ProposalQueue
          proposals={workspace.proposals}
          selectedId={proposal?.id}
          onSelect={setSelectedId}
        />
      </aside>
      <div className="seo-detail-panel">
        {proposal ? (
          <ProposalDetail
            proposal={proposal}
            csrfToken={csrfToken}
            setCsrfToken={setCsrfToken}
            readOnlyReason={readOnlyReason}
            onResult={onResult}
          />
        ) : (
          <div className="seo-empty-state">
            <FileDiff aria-hidden="true" size={24} />
            <strong>Select a proposal</strong>
            <p>Exact diffs, evidence, caveats, and consequences appear here.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricGrid({ metrics }: { metrics: Record<string, unknown> }) {
  const entries = Object.entries(metrics)
  if (entries.length === 0)
    return <p className="seo-muted">No bounded metrics retained.</p>
  return (
    <dl className="seo-metric-grid">
      {entries.slice(0, 20).map(([key, value]) => (
        <div key={key}>
          <dt>{key.replaceAll(/([A-Z])/g, " $1").replaceAll("_", " ")}</dt>
          <dd>{formatSeoMetricValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function ExperimentCard({ experiment }: { experiment: SeoExperiment }) {
  const presentation = presentSeoExperiment(experiment)
  return (
    <article className="seo-experiment-card">
      <header>
        <div>
          <span className="seo-section-eyebrow">
            {experiment.lane} · {experiment.locale}
          </span>
          <h3 dir="auto">{experiment.canonicalUrl}</h3>
        </div>
        <StatusBadge label={presentation.label} tone={presentation.tone} />
      </header>
      <div className={`seo-recovery-guidance is-${presentation.tone}`}>
        <strong>{presentation.nextAction}</strong>
        <p>{presentation.guidance}</p>
      </div>
      <dl className="seo-experiment-timeline">
        <div>
          <dt>Observed activation</dt>
          <dd>{formatSeoDate(experiment.activatedAt)}</dd>
        </div>
        <div>
          <dt>Activation hash</dt>
          <dd>
            <code>{experiment.observedActivationHash ?? "Not observed"}</code>
          </dd>
        </div>
        <div>
          <dt>Interim due</dt>
          <dd>{formatSeoDate(experiment.interimDueAt)}</dd>
        </div>
        <div>
          <dt>Final due</dt>
          <dd>{formatSeoDate(experiment.finalDueAt)}</dd>
        </div>
      </dl>
      {experiment.confounders.length > 0 ? (
        <div className="seo-caveat-box">
          <TriangleAlert aria-hidden="true" size={17} />
          <div>
            <strong>Confounders</strong>
            <ul>
              {experiment.confounders.map((item) => (
                <li key={item} dir="auto">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <section
        className="seo-evaluation-history"
        aria-label="Append-only evaluation history"
      >
        <h4>Evaluation history</h4>
        {experiment.evaluations.length === 0 ? (
          <p className="seo-muted">No evaluation event yet.</p>
        ) : (
          experiment.evaluations.map((evaluation) => (
            <article key={evaluation.id}>
              <div>
                <strong>{evaluation.kind}</strong>
                <span>{evaluation.outcome ?? "Non-terminal"}</span>
                <time>{formatSeoDate(evaluation.observedAt)}</time>
              </div>
              <MetricGrid metrics={evaluation.metrics} />
              <small>Evidence digest · {evaluation.evidenceDigest}</small>
            </article>
          ))
        )}
      </section>
    </article>
  )
}

function ExperimentsView({ experiments }: { experiments: SeoExperiment[] }) {
  if (experiments.length === 0) {
    return (
      <div className="seo-empty-state">
        <Beaker aria-hidden="true" size={24} />
        <strong>No experiments yet</strong>
        <p>
          Approval does not create an active experiment; an objective production
          probe must match first.
        </p>
      </div>
    )
  }
  return (
    <div className="seo-view-stack">
      <header className="seo-view-heading">
        <div>
          <span className="seo-section-eyebrow">Objective activation only</span>
          <h2>Experiments</h2>
          <p>
            GSC determines search conclusions; GA4 and mission outcomes are
            guardrails.
          </p>
        </div>
      </header>
      <div className="seo-experiment-list">
        {experiments.map((experiment) => (
          <ExperimentCard experiment={experiment} key={experiment.id} />
        ))}
      </div>
    </div>
  )
}

function LearningCard({
  lesson,
  csrfToken,
  setCsrfToken,
  readOnlyReason,
  onUpdated,
}: {
  lesson: SeoLesson
  csrfToken: string
  setCsrfToken: (value: string) => void
  readOnlyReason?: string
  onUpdated: (lesson: SeoLesson) => void
}) {
  const [reviewed, setReviewed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const status = normalized(lesson.status)

  async function review(nextStatus: "ACTIVE" | "SUPERSEDED" | "RETIRED") {
    setSubmitting(true)
    setMessage("Saving reviewed learning…")
    try {
      const response = await apiFetch(
        `/api/seo/lessons/${encodeURIComponent(lesson.id)}/review`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-seo-csrf-token": csrfToken,
          },
          body: JSON.stringify({ status: nextStatus }),
        },
      )
      const payload = (await response.json()) as {
        lesson?: SeoLesson
        error?: string
        nextCsrfToken?: string
      }
      if (payload.nextCsrfToken) setCsrfToken(payload.nextCsrfToken)
      if (!response.ok || !payload.lesson) {
        setMessage(payload.error ?? "Learning review did not complete.")
        return
      }
      onUpdated(payload.lesson)
      setMessage(`Learning marked ${payload.lesson.status.toLowerCase()}.`)
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Learning review did not complete.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="seo-learning-card">
      <header>
        <div>
          <span className="seo-section-eyebrow">
            Experiment {lesson.experimentId}
          </span>
          <h3 dir="auto">{lesson.content}</h3>
        </div>
        <StatusBadge
          label={lesson.status.toLowerCase()}
          tone={
            status === "ACTIVE"
              ? "success"
              : status === "PENDING"
                ? "warning"
                : "neutral"
          }
        />
      </header>
      <MetricGrid metrics={lesson.metrics} />
      {lesson.confounders.length > 0 ? (
        <div className="seo-caveat-box">
          <TriangleAlert aria-hidden="true" size={17} />
          <div>
            <strong>Confounders reviewed with this lesson</strong>
            <ul>
              {lesson.confounders.map((item) => (
                <li key={item} dir="auto">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <div className="seo-learning-audit">
        <span>Evidence · {lesson.evidenceDigest}</span>
        <span>Created · {formatSeoDate(lesson.createdAt)}</span>
        <span>Reviewed · {formatSeoDate(lesson.reviewedAt)}</span>
      </div>
      {status === "PENDING" ? (
        <div className="seo-learning-review">
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            <span>
              I reviewed the final metrics, primary GSC outcome, guardrails, and
              confounders.
            </span>
          </label>
          <div className="seo-action-row">
            <button
              type="button"
              className="seo-primary-button"
              disabled={!reviewed || submitting || Boolean(readOnlyReason)}
              onClick={() => void review("ACTIVE")}
            >
              <BookOpenCheck aria-hidden="true" size={17} />
              Activate reviewed lesson
            </button>
            <button
              type="button"
              className="seo-secondary-button"
              disabled={submitting || Boolean(readOnlyReason)}
              onClick={() => void review("RETIRED")}
            >
              Retire
            </button>
          </div>
        </div>
      ) : status === "ACTIVE" ? (
        <div className="seo-action-row">
          <button
            type="button"
            className="seo-secondary-button"
            disabled={submitting || Boolean(readOnlyReason)}
            onClick={() => void review("SUPERSEDED")}
          >
            Mark superseded
          </button>
          <button
            type="button"
            className="seo-secondary-button"
            disabled={submitting || Boolean(readOnlyReason)}
            onClick={() => void review("RETIRED")}
          >
            Retire
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="seo-live-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </article>
  )
}

function LearningsView({
  lessons,
  csrfToken,
  setCsrfToken,
  readOnlyReason,
  onUpdated,
}: {
  lessons: SeoLesson[]
  csrfToken: string
  setCsrfToken: (value: string) => void
  readOnlyReason?: string
  onUpdated: (lesson: SeoLesson) => void
}) {
  const ordered = [...lessons].sort((left, right) => {
    const priority = { PENDING: 0, ACTIVE: 1, SUPERSEDED: 2, RETIRED: 3 }
    return (
      (priority[normalized(left.status) as keyof typeof priority] ?? 4) -
      (priority[normalized(right.status) as keyof typeof priority] ?? 4)
    )
  })
  return (
    <div className="seo-view-stack">
      <header className="seo-view-heading">
        <div>
          <span className="seo-section-eyebrow">Reviewed reuse only</span>
          <h2>Learnings</h2>
          <p>
            Harmful, neutral, and inconclusive outcomes stay visible so future
            analysis is not success-biased.
          </p>
        </div>
      </header>
      {ordered.length === 0 ? (
        <div className="seo-empty-state">
          <BookOpenCheck aria-hidden="true" size={24} />
          <strong>No learning reviews yet</strong>
          <p>
            Only activated, sufficiently measured, non-confounded experiments
            are eligible.
          </p>
        </div>
      ) : (
        <div className="seo-learning-list">
          {ordered.map((lesson) => (
            <LearningCard
              key={lesson.id}
              lesson={lesson}
              csrfToken={csrfToken}
              setCsrfToken={setCsrfToken}
              readOnlyReason={readOnlyReason}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CandidateTicket({
  candidate,
  payloadDigest,
  selected,
  onSelect,
}: {
  candidate: SeoCandidateTicket
  payloadDigest: string
  selected: boolean
  onSelect: () => void
}) {
  const exact =
    !candidate.payloadDigest || candidate.payloadDigest === payloadDigest
  return (
    <label
      className={`seo-candidate-ticket ${selected ? "is-selected" : ""} ${exact ? "" : "is-mismatch"}`}
    >
      <input
        type="radio"
        checked={selected}
        disabled={!exact}
        onChange={onSelect}
      />
      <span>
        <strong>
          {candidate.remoteId} · {candidate.title}
        </strong>
        <small>{candidate.team ?? "Team unavailable"}</small>
        <code>{candidate.payloadDigest ?? "Digest verified by Admin"}</code>
        {safeTextLink(candidate.remoteUrl, "Inspect ticket")}
        {!exact ? (
          <em>Payload digest does not match; binding is disabled.</em>
        ) : null}
      </span>
    </label>
  )
}

function ReconciliationCard({
  item,
  proposal,
  csrfToken,
  setCsrfToken,
  readOnlyReason,
  onUpdated,
}: {
  item: SeoTicketReconciliation
  proposal?: SeoProposal
  csrfToken: string
  setCsrfToken: (value: string) => void
  readOnlyReason?: string
  onUpdated: (value: SeoTicketReconciliation) => void
}) {
  const [selectedId, setSelectedId] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const selected = item.candidateTickets.find(
    (ticket) => ticket.remoteId === selectedId,
  )

  async function reconcile(action: "BIND_EXISTING" | "MARK_FAILED") {
    setSubmitting(true)
    setMessage(
      action === "BIND_EXISTING"
        ? "Binding verified ticket…"
        : "Marking delivery failed…",
    )
    try {
      const response = await apiFetch(
        `/api/seo/reconciliation/${encodeURIComponent(item.outboxId)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-seo-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            action,
            ...(action === "BIND_EXISTING" && selected
              ? { remoteId: selected.remoteId, remoteUrl: selected.remoteUrl }
              : {}),
          }),
        },
      )
      const payload = (await response.json()) as {
        reconciliation?: SeoTicketReconciliation
        error?: string
        nextCsrfToken?: string
      }
      if (payload.nextCsrfToken) setCsrfToken(payload.nextCsrfToken)
      if (!response.ok || !payload.reconciliation) {
        setMessage(payload.error ?? "Ticket reconciliation did not complete.")
        return
      }
      onUpdated(payload.reconciliation)
      setMessage(
        `Reconciliation marked ${payload.reconciliation.status.toLowerCase()}.`,
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Ticket reconciliation did not complete.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className="seo-reconciliation-card">
      <header>
        <div>
          <span className="seo-section-eyebrow">Outbox {item.outboxId}</span>
          <h3>Ambiguous remote ticket delivery</h3>
        </div>
        <StatusBadge label={item.status.toLowerCase()} tone="danger" />
      </header>
      <div className="seo-recovery-guidance is-danger">
        <strong>Automatic creation is paused.</strong>
        <p>
          Bind one exact verified existing ticket or mark this delivery failed.
          This surface has no create action.
        </p>
      </div>
      <dl className="seo-reconciliation-meta">
        <div>
          <dt>Proposal</dt>
          <dd>
            {item.proposalId} · v{item.proposalVersion}
          </dd>
        </div>
        <div>
          <dt>Marker</dt>
          <dd>
            <code>{item.marker}</code>
          </dd>
        </div>
        <div>
          <dt>Payload digest</dt>
          <dd>
            <code>{item.payloadDigest}</code>
          </dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>{item.attemptCount}</dd>
        </div>
      </dl>
      {proposal?.engineeringBrief ? (
        <EngineeringBrief proposal={proposal} />
      ) : null}
      <section className="seo-reconciliation-section">
        <h4>Delivery attempts</h4>
        {item.attempts.map((attempt) => (
          <div className="seo-attempt-row" key={attempt.id}>
            <Clock3 aria-hidden="true" size={16} />
            <strong>{attempt.status}</strong>
            <span>{formatSeoDate(attempt.attemptedAt)}</span>
            <code>{attempt.errorCode ?? "No error code"}</code>
          </div>
        ))}
      </section>
      <fieldset className="seo-reconciliation-section">
        <legend>Exact candidate tickets</legend>
        {item.candidateTickets.length === 0 ? (
          <p className="seo-muted">
            No exact candidate was retained. Mark delivery failed for manual
            follow-up.
          </p>
        ) : (
          <div className="seo-candidate-list">
            {item.candidateTickets.map((candidate) => (
              <CandidateTicket
                key={candidate.remoteId}
                candidate={candidate}
                payloadDigest={item.payloadDigest}
                selected={selectedId === candidate.remoteId}
                onSelect={() => setSelectedId(candidate.remoteId)}
              />
            ))}
          </div>
        )}
      </fieldset>
      <div className="seo-action-row">
        <button
          type="button"
          className="seo-primary-button"
          disabled={!selected || submitting || Boolean(readOnlyReason)}
          onClick={() => void reconcile("BIND_EXISTING")}
        >
          <TicketCheck aria-hidden="true" size={17} />
          Bind selected existing ticket
        </button>
        <button
          type="button"
          className="seo-secondary-button"
          disabled={submitting || Boolean(readOnlyReason)}
          onClick={() => void reconcile("MARK_FAILED")}
        >
          Mark delivery failed
        </button>
      </div>
      {message ? (
        <p className="seo-live-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </article>
  )
}

function ReconciliationView({
  items,
  proposals,
  csrfToken,
  setCsrfToken,
  readOnlyReason,
  onUpdated,
}: {
  items: SeoTicketReconciliation[]
  proposals: SeoProposal[]
  csrfToken: string
  setCsrfToken: (value: string) => void
  readOnlyReason?: string
  onUpdated: (value: SeoTicketReconciliation) => void
}) {
  return (
    <div className="seo-view-stack">
      <header className="seo-view-heading">
        <div>
          <span className="seo-section-eyebrow">Effectively-once delivery</span>
          <h2>Reconciliation</h2>
          <p>
            Resolve ambiguous remote success without risking an automatic
            duplicate.
          </p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="seo-empty-state">
          <CheckCircle2 aria-hidden="true" size={24} />
          <strong>No manual reconciliation work</strong>
          <p>
            Ticket creation remains with the fenced dispatcher; this view never
            creates tickets.
          </p>
        </div>
      ) : (
        <div className="seo-reconciliation-list">
          {items.map((item) => (
            <ReconciliationCard
              key={item.outboxId}
              item={item}
              proposal={proposals.find(
                (proposal) => proposal.id === item.proposalId,
              )}
              csrfToken={csrfToken}
              setCsrfToken={setCsrfToken}
              readOnlyReason={readOnlyReason}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SeoWorkspace({
  initialWorkspace,
  initialView,
  initialCsrfToken,
  readOnlyReason,
  loadError,
  isDemo,
}: WorkspaceProps) {
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [view, setView] = useState<SeoWorkspaceView>(initialView)
  const [selectedProposalId, setSelectedProposalId] = useState<
    string | undefined
  >(initialWorkspace.proposals[0]?.id)
  const [csrfToken, setCsrfToken] = useState(initialCsrfToken)

  function navigate(nextView: SeoWorkspaceView, proposalId?: string) {
    if (nextView === "runs" || view === "runs") {
      const url = new URL(window.location.href)
      url.searchParams.set("view", nextView)
      url.searchParams.delete("cursor")
      window.location.assign(`${url.pathname}?${url.searchParams.toString()}`)
      return
    }
    setView(nextView)
    if (proposalId) setSelectedProposalId(proposalId)
    const url = new URL(window.location.href)
    url.searchParams.set("view", nextView)
    window.history.replaceState(null, "", url)
  }

  function applyDecisionResult(result: SeoProposalDecisionResult) {
    setWorkspace((current) => ({
      ...current,
      proposals: current.proposals.map((proposal) => {
        if (
          proposal.id !== result.proposalId ||
          proposal.version !== result.version
        ) {
          return proposal
        }
        const resultPresentation = presentDecisionResult(result)
        return {
          ...proposal,
          status: result.status,
          materialization: {
            ...(proposal.materialization ?? {}),
            status: result.draftRevisionId
              ? "DRAFT_CREATED"
              : result.ticketOutboxId
                ? "TICKET_PENDING"
                : result.status,
            draftRevisionId: result.draftRevisionId,
            editorPath: result.editorPath,
            ticketOutboxId: result.ticketOutboxId,
          },
          decision: {
            ...(proposal.decision ?? {}),
            status: resultPresentation.label,
          },
        }
      }),
    }))
  }

  const viewContent = (() => {
    switch (view) {
      case "overview":
        return (
          <OverviewView
            workspace={workspace}
            loadError={loadError}
            onNavigate={navigate}
          />
        )
      case "proposals":
        return (
          <ProposalsView
            workspace={workspace}
            selectedId={selectedProposalId}
            setSelectedId={setSelectedProposalId}
            csrfToken={csrfToken}
            setCsrfToken={setCsrfToken}
            readOnlyReason={readOnlyReason}
            onResult={applyDecisionResult}
          />
        )
      case "experiments":
        return <ExperimentsView experiments={workspace.experiments} />
      case "learnings":
        return (
          <LearningsView
            lessons={workspace.lessons}
            csrfToken={csrfToken}
            setCsrfToken={setCsrfToken}
            readOnlyReason={readOnlyReason}
            onUpdated={(lesson) =>
              setWorkspace((current) => ({
                ...current,
                lessons: current.lessons.map((candidate) =>
                  candidate.id === lesson.id ? lesson : candidate,
                ),
              }))
            }
          />
        )
      case "reconciliation":
        return (
          <ReconciliationView
            items={workspace.ticketReconciliations}
            proposals={workspace.proposals}
            csrfToken={csrfToken}
            setCsrfToken={setCsrfToken}
            readOnlyReason={readOnlyReason}
            onUpdated={(reconciliation) =>
              setWorkspace((current) => ({
                ...current,
                ticketReconciliations: current.ticketReconciliations.map(
                  (candidate) =>
                    candidate.outboxId === reconciliation.outboxId
                      ? reconciliation
                      : candidate,
                ),
              }))
            }
          />
        )
      case "runs":
        return null
    }
  })()

  return (
    <section className="seo-workspace" aria-labelledby="seo-workspace-title">
      <header className="seo-workspace-hero">
        <div>
          <span className="studio-page-eyebrow">
            Search growth · human controlled
          </span>
          <h1 id="seo-workspace-title">SEO workspace</h1>
          <p>
            Review evidence-backed actions, preserve exact decisions, and follow
            outcomes without granting an agent publish or deployment authority.
          </p>
        </div>
        <div className="seo-workspace-mode">
          <StatusBadge
            label={
              isDemo ? "Demo data" : loadError ? "Unavailable" : "Admin ledger"
            }
            tone={isDemo ? "warning" : loadError ? "danger" : "success"}
          />
          <small>
            {isDemo
              ? "Stable mock-mode fixtures for screenshot and interaction smoke."
              : "Bounded Admin-owned snapshot; raw provider bodies are not returned."}
          </small>
        </div>
      </header>

      <SeoWorkspaceTabs view={view} onSelect={navigate} />

      <div
        className="seo-view-panel"
        role="tabpanel"
        id={`seo-panel-${view}`}
        aria-labelledby={`seo-tab-${view}`}
      >
        {viewContent}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {SEO_WORKSPACE_VIEW_META[view].label} view selected.
      </div>
    </section>
  )
}
