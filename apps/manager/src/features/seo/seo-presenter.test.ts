import { describe, expect, it } from "vitest"
import { buildSeoDemoWorkspace, type SeoProposal } from "./seo-contract"
import {
  buildSeoOverviewQueue,
  formatSeoMetricValue,
  getProposalLifecycleState,
  presentDecisionResult,
  presentSeoExperiment,
  presentSeoProposal,
  sortSeoEvidence,
  summarizeProviders,
} from "./seo-presenter"

function proposalWith(
  status: string,
  materializationStatus?: string,
): SeoProposal {
  const proposal = buildSeoDemoWorkspace().proposals[1]
  return {
    ...proposal,
    status,
    overlapCount: status === "BLOCKED" ? 1 : 0,
    materialization: materializationStatus
      ? { status: materializationStatus }
      : null,
  }
}

describe("SEO proposal lifecycle presentation", () => {
  it.each([
    ["PROPOSED", true, true, "Ready for review"],
    ["BLOCKED", true, true, "Approval blocked"],
    ["STALE", false, false, "Target changed"],
    ["EXISTING_DRAFT", false, true, "Existing draft"],
    ["APPROVED", false, false, "Approved"],
    ["DRAFT_CREATED", false, false, "Admin draft created"],
    ["TICKET_PENDING", false, false, "Ticket pending"],
    ["TICKET_CREATED", false, false, "Ticket created"],
    ["MANUAL_RECONCILE", false, false, "Manual reconciliation"],
    ["AWAITING_ACTIVATION", false, false, "Awaiting activation"],
    ["ACTIVATED", false, false, "Measuring"],
    ["REJECTED", false, false, "Rejected"],
    ["EXPIRED", false, false, "Expired"],
    ["CONFLICT", false, false, "Concurrent conflict"],
    ["ALREADY_DECIDED", false, false, "Already decided"],
    ["RETRYABLE_FAILURE", true, true, "Temporary failure"],
    ["TERMINAL_FAILURE", false, false, "Action unavailable"],
  ])(
    "presents %s with state-specific authority and recovery",
    (status, canApprove, canReject, label) => {
      expect(presentSeoProposal(proposalWith(status))).toMatchObject({
        label,
        canApprove,
        canReject,
      })
    },
  )

  it("lets materialization state take precedence over the decision state", () => {
    const proposal = proposalWith("APPROVED", "DRAFT_CREATED")
    expect(getProposalLifecycleState(proposal)).toBe("DRAFT_CREATED")
    expect(presentSeoProposal(proposal).guidance).toContain(
      "Canonical content is still live",
    )
  })

  it("never describes a draft as published or a ticket as deployed", () => {
    expect(
      presentDecisionResult({
        status: "APPROVED",
        proposalId: "proposal-1",
        version: 1,
        draftRevisionId: "revision-1",
      }).guidance,
    ).toContain("Canonical content is still live")
    expect(
      presentDecisionResult({
        status: "APPROVED",
        proposalId: "proposal-1",
        version: 1,
        ticketOutboxId: "outbox-1",
      }).guidance,
    ).toContain("does not mean a ticket was delivered")
  })
})

describe("SEO evidence and overview presentation", () => {
  it("orders primary search evidence ahead of guardrails and observations", () => {
    const proposal = buildSeoDemoWorkspace().proposals[1]
    expect(
      sortSeoEvidence(proposal.evidence).map((item) => item.provider),
    ).toEqual(["GSC", "GA4", "FIRECRAWL", "GROUNDED_SEARCH"])
  })

  it("makes the weakest retained provider state visible", () => {
    const providers = summarizeProviders(buildSeoDemoWorkspace())
    expect(
      providers.find((provider) => provider.provider === "GSC")?.status,
    ).toBe("INSUFFICIENT")
    expect(
      providers.find((provider) => provider.provider === "GROUNDED_SEARCH")
        ?.status,
    ).toBe("UNAVAILABLE")
  })

  it("prioritizes rollback, reconciliation, blocked approval, new proposal, then exceptions", () => {
    const kinds = buildSeoOverviewQueue(buildSeoDemoWorkspace()).map(
      (item) => item.kind,
    )
    expect(kinds.slice(0, 4)).toEqual([
      "rollback",
      "reconciliation",
      "blocked",
      "blocked",
    ])
    expect(kinds.at(-1)).toBe("exception")
  })
})

describe("SEO experiment presentation", () => {
  it("keeps harmful and insufficient-data outcomes distinct", () => {
    const [harmful, insufficient] = buildSeoDemoWorkspace().experiments
    expect(presentSeoExperiment(harmful)).toMatchObject({
      label: "Harmful",
      tone: "danger",
    })
    expect(presentSeoExperiment(insufficient)).toMatchObject({
      label: "Insufficient data",
      tone: "warning",
    })
    expect(presentSeoExperiment(insufficient).guidance).toContain(
      "minimum GSC impression threshold",
    )
  })

  it("formats ratios as percentages and counts as numbers", () => {
    expect(formatSeoMetricValue(-0.184)).toBe("-18.4%")
    expect(formatSeoMetricValue(2490)).toBe("2,490")
  })
})
