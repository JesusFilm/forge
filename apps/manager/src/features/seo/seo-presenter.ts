import type {
  SeoEvidenceObservation,
  SeoEvidenceProvider,
  SeoExperiment,
  SeoProposal,
  SeoProposalDecisionResult,
  SeoWorkspace,
} from "./seo-contract"

export type SeoTone = "danger" | "warning" | "success" | "neutral"

export type SeoProposalPresentation = {
  label: string
  tone: SeoTone
  nextAction: string
  guidance: string
  canApprove: boolean
  canReject: boolean
  focusTarget: "actions" | "editor-link" | "reconciliation" | "history"
}

const PROPOSAL_PRESENTATIONS: Record<string, SeoProposalPresentation> = {
  PROPOSED: {
    label: "Ready for review",
    tone: "neutral",
    nextAction: "Review the evidence and exact treatment.",
    guidance:
      "Approve only the immutable version shown here, or reject it with a durable reason.",
    canApprove: true,
    canReject: true,
    focusTarget: "actions",
  },
  BLOCKED: {
    label: "Approval blocked",
    tone: "warning",
    nextAction: "Resolve or acknowledge the reported overlap.",
    guidance:
      "Refresh the proposal after any target edit. If the overlap is intentional, acknowledge it so evaluation records the confounder.",
    canApprove: true,
    canReject: true,
    focusTarget: "actions",
  },
  STALE: {
    label: "Target changed",
    tone: "warning",
    nextAction:
      "Refresh the canonical target and request a new proposal version.",
    guidance:
      "The saved base no longer matches production or Admin. This immutable version cannot be applied safely.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  EXISTING_DRAFT: {
    label: "Existing draft",
    tone: "warning",
    nextAction: "Open Admin and review the existing human or AI draft.",
    guidance:
      "Manager will not overwrite another draft. Resolve it in Admin, then refresh this proposal.",
    canApprove: false,
    canReject: true,
    focusTarget: "editor-link",
  },
  APPROVED: {
    label: "Approved",
    tone: "success",
    nextAction: "Follow the materialization state below.",
    guidance:
      "Approval records a decision only. Publication and deployment remain separate human-controlled steps.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  DRAFT_CREATED: {
    label: "Admin draft created",
    tone: "success",
    nextAction: "Review and publish the draft in Admin when ready.",
    guidance:
      "Canonical content is still live and unchanged. Measurement starts only after an objective production hash matches.",
    canApprove: false,
    canReject: false,
    focusTarget: "editor-link",
  },
  TICKET_PENDING: {
    label: "Ticket pending",
    tone: "neutral",
    nextAction: "Wait for the fenced ticket dispatcher.",
    guidance:
      "A durable outbox entry exists. This does not mean a ticket was delivered or code was deployed.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  TICKET_CREATED: {
    label: "Ticket created",
    tone: "success",
    nextAction: "Track implementation and the registered production probe.",
    guidance:
      "A ticket is not a deployment. The experiment remains inactive until the server-validated probe matches.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  MANUAL_RECONCILE: {
    label: "Manual reconciliation",
    tone: "danger",
    nextAction: "Bind one exact existing ticket or mark delivery failed.",
    guidance:
      "Remote success is ambiguous. Automatic creation is paused to prevent a duplicate ticket.",
    canApprove: false,
    canReject: false,
    focusTarget: "reconciliation",
  },
  AWAITING_ACTIVATION: {
    label: "Awaiting activation",
    tone: "neutral",
    nextAction: "Complete the human publish or deployment handoff.",
    guidance:
      "Operator confirmation cannot activate the experiment; the objective probe must observe the exact treatment.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  ACTIVATED: {
    label: "Measuring",
    tone: "neutral",
    nextAction: "Wait for comparable registered windows.",
    guidance:
      "Interim checks are non-terminal. GSC controls the final search conclusion and guardrails can still make an outcome harmful.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  REJECTED: {
    label: "Rejected",
    tone: "neutral",
    nextAction: "Review the decision reason before proposing a new version.",
    guidance: "This immutable version cannot later be approved.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  EXPIRED: {
    label: "Expired",
    tone: "warning",
    nextAction: "Run a fresh evidence collection and proposal pass.",
    guidance:
      "Evidence and target state are outside the review window; do not reuse this treatment without revalidation.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  CONFLICT: {
    label: "Concurrent conflict",
    tone: "warning",
    nextAction: "Refresh before taking another action.",
    guidance:
      "Another operator or target change won the transition. No retry should be attempted against stale state.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  ALREADY_DECIDED: {
    label: "Already decided",
    tone: "neutral",
    nextAction: "Review the recorded decision and materialization.",
    guidance: "The repeat request did not create another decision or draft.",
    canApprove: false,
    canReject: false,
    focusTarget: "history",
  },
  RETRYABLE_FAILURE: {
    label: "Temporary failure",
    tone: "warning",
    nextAction: "Retry once after confirming the proposal is still current.",
    guidance:
      "No successful decision was observed. Keep the exact version open and avoid repeated rapid submissions.",
    canApprove: true,
    canReject: true,
    focusTarget: "actions",
  },
  TERMINAL_FAILURE: {
    label: "Action unavailable",
    tone: "danger",
    nextAction: "Escalate the configuration or authorization error.",
    guidance:
      "Do not work around this with a service key or direct content mutation.",
    canApprove: false,
    canReject: false,
    focusTarget: "actions",
  },
}

function normalizedStatus(value?: string): string {
  return (value ?? "PROPOSED").trim().toUpperCase().replaceAll("-", "_")
}

export function getProposalLifecycleState(proposal: SeoProposal): string {
  const materialization = normalizedStatus(proposal.materialization?.status)
  if (
    proposal.materialization?.status &&
    PROPOSAL_PRESENTATIONS[materialization]
  ) {
    return materialization
  }

  const status = normalizedStatus(proposal.status)
  return PROPOSAL_PRESENTATIONS[status] ? status : "TERMINAL_FAILURE"
}

export function presentSeoProposal(
  proposal: SeoProposal,
): SeoProposalPresentation {
  return PROPOSAL_PRESENTATIONS[getProposalLifecycleState(proposal)]
}

export function presentDecisionResult(
  result: SeoProposalDecisionResult,
): SeoProposalPresentation {
  const state =
    result.status === "APPROVED"
      ? result.draftRevisionId
        ? "DRAFT_CREATED"
        : result.ticketOutboxId
          ? "TICKET_PENDING"
          : "APPROVED"
      : result.status
  return (
    PROPOSAL_PRESENTATIONS[state] ?? PROPOSAL_PRESENTATIONS.TERMINAL_FAILURE
  )
}

const EVIDENCE_PRIORITY: Record<SeoEvidenceProvider, number> = {
  GSC: 0,
  GA4: 1,
  PAGE: 2,
  FIRECRAWL: 3,
  GROUNDED_SEARCH: 4,
  UNKNOWN: 5,
}

export function sortSeoEvidence(
  evidence: SeoEvidenceObservation[],
): SeoEvidenceObservation[] {
  return [...evidence].sort(
    (left, right) =>
      EVIDENCE_PRIORITY[left.provider] - EVIDENCE_PRIORITY[right.provider],
  )
}

export type SeoProviderSummary = {
  provider: SeoEvidenceProvider
  label: string
  status: SeoEvidenceObservation["status"]
  note: string
}

const PROVIDER_LABELS: Record<SeoEvidenceProvider, string> = {
  GSC: "Search Console",
  GA4: "Google Analytics",
  FIRECRAWL: "Firecrawl",
  PAGE: "Direct page state",
  GROUNDED_SEARCH: "Grounded search",
  UNKNOWN: "Other evidence",
}

const STATUS_PRIORITY: Record<SeoEvidenceObservation["status"], number> = {
  AVAILABLE: 0,
  PARTIAL: 1,
  INSUFFICIENT: 2,
  UNAVAILABLE: 3,
}

export function summarizeProviders(
  workspace: SeoWorkspace,
): SeoProviderSummary[] {
  const byProvider = new Map<SeoEvidenceProvider, SeoEvidenceObservation[]>()
  for (const proposal of workspace.proposals) {
    for (const observation of proposal.evidence) {
      const current = byProvider.get(observation.provider) ?? []
      current.push(observation)
      byProvider.set(observation.provider, current)
    }
  }

  return Array.from(byProvider.entries())
    .map(([provider, observations]) => {
      const weakest = [...observations].sort(
        (left, right) =>
          STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status],
      )[0]
      return {
        provider,
        label: PROVIDER_LABELS[provider],
        status: weakest.status,
        note:
          weakest.coverage ??
          (weakest.status === "AVAILABLE"
            ? `${observations.length} retained observation${observations.length === 1 ? "" : "s"}.`
            : weakest.summary),
      }
    })
    .sort(
      (left, right) =>
        EVIDENCE_PRIORITY[left.provider] - EVIDENCE_PRIORITY[right.provider],
    )
}

export type SeoOverviewItem = {
  id: string
  kind: "rollback" | "reconciliation" | "blocked" | "proposal" | "exception"
  title: string
  detail: string
  targetView: "proposals" | "experiments" | "reconciliation"
  proposalId?: string
}

export function buildSeoOverviewQueue(
  workspace: SeoWorkspace,
): SeoOverviewItem[] {
  const items: SeoOverviewItem[] = []

  for (const proposal of workspace.proposals) {
    const state = getProposalLifecycleState(proposal)
    if (normalizedStatus(proposal.lane) === "ROLLBACK") {
      items.push({
        id: `rollback:${proposal.id}`,
        kind: "rollback",
        title: `Rollback review · ${proposal.locale}`,
        detail: proposal.risk,
        targetView: "proposals",
        proposalId: proposal.id,
      })
    } else if (state === "BLOCKED" || proposal.overlapCount > 0) {
      items.push({
        id: `blocked:${proposal.id}`,
        kind: "blocked",
        title: `Blocked approval · ${proposal.locale}`,
        detail: `${proposal.overlapCount} overlapping change${proposal.overlapCount === 1 ? "" : "s"}; review before approval.`,
        targetView: "proposals",
        proposalId: proposal.id,
      })
    } else if (state === "PROPOSED") {
      items.push({
        id: `proposal:${proposal.id}`,
        kind: "proposal",
        title: `${proposal.lane.toLowerCase()} proposal · ${proposal.locale}`,
        detail: proposal.expectedOutcome,
        targetView: "proposals",
        proposalId: proposal.id,
      })
    }
  }

  for (const reconciliation of workspace.ticketReconciliations) {
    if (normalizedStatus(reconciliation.status) !== "MANUAL_RECONCILE") continue
    items.push({
      id: `reconciliation:${reconciliation.outboxId}`,
      kind: "reconciliation",
      title: "Ambiguous ticket delivery",
      detail: `${reconciliation.candidateTickets.length} candidate ticket${reconciliation.candidateTickets.length === 1 ? "" : "s"}; automatic creation is paused.`,
      targetView: "reconciliation",
      proposalId: reconciliation.proposalId,
    })
  }

  const providerExceptions = summarizeProviders(workspace).filter(
    (provider) => provider.status !== "AVAILABLE",
  )
  for (const provider of providerExceptions) {
    items.push({
      id: `provider:${provider.provider}`,
      kind: "exception",
      title: `${provider.label} · ${provider.status.toLowerCase()}`,
      detail: provider.note,
      targetView: "proposals",
    })
  }

  const priority: Record<SeoOverviewItem["kind"], number> = {
    rollback: 0,
    reconciliation: 1,
    blocked: 2,
    proposal: 3,
    exception: 4,
  }
  return items.sort((left, right) => priority[left.kind] - priority[right.kind])
}

export type SeoExperimentPresentation = {
  label: string
  tone: SeoTone
  nextAction: string
  guidance: string
}

export function presentSeoExperiment(
  experiment: SeoExperiment,
): SeoExperimentPresentation {
  switch (normalizedStatus(experiment.status)) {
    case "HARMFUL":
      return {
        label: "Harmful",
        tone: "danger",
        nextAction: "Review the linked rollback proposal.",
        guidance:
          "No automatic rollback occurs. Confirm production still matches the treatment before approving restoration.",
      }
    case "INSUFFICIENT_DATA":
    case "INSUFFICIENT":
      return {
        label: "Insufficient data",
        tone: "warning",
        nextAction: "Wait for a comparable window or close as inconclusive.",
        guidance:
          "The minimum GSC impression threshold was not met; other evidence cannot promote this to beneficial.",
      }
    case "INCONCLUSIVE":
    case "CONFOUNDED":
      return {
        label: "Inconclusive",
        tone: "warning",
        nextAction:
          "Review overlaps and anomalies before reusing the treatment.",
        guidance: "Confounded work cannot create an active lesson.",
      }
    case "BENEFICIAL":
      return {
        label: "Beneficial",
        tone: "success",
        nextAction: "Review the proposed learning with final evidence.",
        guidance:
          "A positive verdict does not activate a lesson automatically.",
      }
    case "NEUTRAL":
      return {
        label: "Neutral",
        tone: "neutral",
        nextAction: "Retain the result before proposing another treatment.",
        guidance: "Neutral outcomes remain visible to prevent success bias.",
      }
    case "MEASURING":
    case "ACTIVATED":
      return {
        label: "Measuring",
        tone: "neutral",
        nextAction: "Wait for the next registered evaluation window.",
        guidance: "Interim results do not end measurement.",
      }
    case "AWAITING_ACTIVATION":
      return {
        label: "Awaiting activation",
        tone: "neutral",
        nextAction:
          "Complete publication or deployment and wait for the probe.",
        guidance: "Approval alone cannot start measurement.",
      }
    default:
      return {
        label: experiment.status.replaceAll("_", " ").toLowerCase(),
        tone: "neutral",
        nextAction: "Review the latest evaluation event.",
        guidance: "Experiment history is append-only.",
      }
  }
}

export function formatSeoMetricValue(value: unknown): string {
  if (typeof value === "number") {
    if (Math.abs(value) <= 1 && value !== 0) {
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value)
    }
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
      value,
    )
  }
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return "Not reported"
}

export function formatSeoDate(value?: string): string {
  if (!value) return "Not yet"
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}
