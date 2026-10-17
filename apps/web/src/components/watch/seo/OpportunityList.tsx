import { cn } from "@/lib/utils"

import {
  AvailabilityBadge,
  CtaOutcome,
  displayableData,
  EvidenceProvenance,
  seoActionClass,
} from "./presentation"
import type { OpportunityDecisionState, SeoOpportunity } from "./types"

const decisionMessages: Record<OpportunityDecisionState, string> = {
  current: "Ready to review in Admin.",
  stale:
    "This proposal has changed. Refresh the evidence before making a decision.",
  expired: "This proposal has expired. Request fresh evidence in Admin.",
  already_decided:
    "A decision has already been recorded. Review its outcome in Admin.",
  conflict:
    "Another change conflicts with this proposal. Resolve the conflict in Admin.",
  replay:
    "This confirmation was already used. Refresh to see the recorded decision.",
  rejected:
    "Admin rejected this request. Refresh the evidence before trying again.",
  retryable_error:
    "Admin could not confirm the outcome. Refresh to check the decision before trying again.",
}

/** Builds a navigation link only. The Admin page owns authorization and confirmation. */
export function getWatchSeoAdminConfirmationHref({
  adminOrigin,
  adminConfirmationUrl,
  opportunity,
  decision,
}: {
  adminOrigin: string
  adminConfirmationUrl: string
  opportunity: Pick<SeoOpportunity, "proposalId" | "version" | "payloadDigest">
  decision: "apply" | "decline"
}): string | null {
  try {
    const origin = new URL(adminOrigin)
    const url = new URL(adminConfirmationUrl)
    if (
      origin.protocol !== "https:" ||
      url.origin !== origin.origin ||
      url.username ||
      url.password ||
      url.hash ||
      !opportunity.proposalId ||
      !Number.isSafeInteger(opportunity.version) ||
      opportunity.version < 1 ||
      !opportunity.payloadDigest
    )
      return null
    url.searchParams.set("proposalId", opportunity.proposalId)
    url.searchParams.set("version", String(opportunity.version))
    url.searchParams.set("payloadDigest", opportunity.payloadDigest)
    url.searchParams.set("decision", decision)
    return url.href
  } catch {
    return null
  }
}

export function OpportunityList({
  items,
  adminOrigin,
  adminConfirmationUrl,
  actionsAvailable,
}: {
  items: SeoOpportunity[]
  adminOrigin: string
  adminConfirmationUrl: string
  actionsAvailable: boolean
}) {
  if (!items.length)
    return (
      <p className="text-sm text-stone-300">
        No opportunities were supplied for this page. This does not establish
        that there is nothing to improve.
      </p>
    )
  return (
    <div className="grid gap-3">
      {items.map((opportunity) => {
        const current =
          actionsAvailable && opportunity.decisionState === "current"
        const apply = current
          ? getWatchSeoAdminConfirmationHref({
              adminOrigin,
              adminConfirmationUrl,
              opportunity,
              decision: "apply",
            })
          : null
        const decline = current
          ? getWatchSeoAdminConfirmationHref({
              adminOrigin,
              adminConfirmationUrl,
              opportunity,
              decision: "decline",
            })
          : null
        return (
          <article
            key={`${opportunity.proposalId}-${opportunity.version}`}
            data-proposal-id={opportunity.proposalId}
            className="min-w-0 overflow-hidden rounded-[9px] border border-white/10 border-l-4 border-l-brand-red bg-[#111013]"
          >
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-red/15 px-2 py-1 text-[9px] font-semibold tracking-wide text-red-200 uppercase">
                    Recommended test
                  </span>
                  <span className="text-[10px] text-stone-400">
                    {opportunity.confidence} confidence
                  </span>
                </div>
                <h4 className="text-base font-semibold tracking-tight text-white sm:text-lg">
                  {opportunity.title}
                </h4>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-stone-300">
                  {opportunity.evidence}
                </p>
                <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-md bg-white/[0.035] p-3">
                    <dt className="text-[9px] font-semibold tracking-wide text-stone-500 uppercase">
                      Expected impact
                    </dt>
                    <dd className="mt-1 leading-relaxed text-stone-200">
                      {opportunity.expectedImpact}
                    </dd>
                  </div>
                  <div className="rounded-md bg-white/[0.035] p-3">
                    <dt className="text-[9px] font-semibold tracking-wide text-stone-500 uppercase">
                      Action
                    </dt>
                    <dd className="mt-1 leading-relaxed text-stone-200">
                      {opportunity.actionSummary}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="space-y-3 rounded-md border border-white/8 bg-[#1b181c] p-3">
                {opportunity.ctaEvidence.length ? (
                  opportunity.ctaEvidence.map((family, index) => {
                    const cta = displayableData(family)
                    return (
                      <div key={index} className="space-y-2 text-stone-200">
                        <AvailabilityBadge state={family.state} />
                        {cta ? (
                          <CtaOutcome cta={cta} />
                        ) : (
                          <p className="text-xs">
                            CTA click and outcome evidence: Unavailable.
                          </p>
                        )}
                        <EvidenceProvenance family={family} />
                      </div>
                    )
                  })
                ) : (
                  <p className="text-xs text-stone-300">
                    CTA click and outcome evidence: Unavailable. No measured
                    outcome is implied by this recommendation.
                  </p>
                )}
              </div>
            </div>
            <div className="grid gap-3 border-t border-white/10 bg-white/[0.025] p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <p className="text-[10px] leading-relaxed text-stone-400">
                Choose a decision. Admin confirmation opens before anything is
                recorded; Apply never publishes directly.
              </p>
              <div className="min-w-0">
                {apply ? (
                  <a
                    className={cn(
                      seoActionClass,
                      "w-full min-w-24 bg-brand-red font-semibold text-white hover:bg-red-700",
                    )}
                    href={apply}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    data-decision="apply"
                    aria-label={`Apply: ${opportunity.title} (opens Admin confirmation in a new tab)`}
                  >
                    Apply
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className={cn(
                      seoActionClass,
                      "w-full border-white/15 bg-white/8 text-stone-400 disabled:cursor-not-allowed",
                    )}
                  >
                    Apply
                  </button>
                )}
                <p className="mt-1 max-w-40 text-[9px] leading-relaxed text-stone-500">
                  {opportunity.applyOutcome}
                </p>
              </div>
              <div className="min-w-0">
                {decline ? (
                  <a
                    className={cn(
                      seoActionClass,
                      "w-full min-w-24 border-stone-500 bg-transparent text-stone-100 hover:bg-stone-700",
                    )}
                    href={decline}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    data-decision="decline"
                    aria-label={`Decline: ${opportunity.title} (opens Admin confirmation in a new tab)`}
                  >
                    Decline
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className={cn(
                      seoActionClass,
                      "w-full border-white/20 bg-transparent text-white disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    Decline
                  </button>
                )}
                <p className="mt-1 max-w-40 text-[9px] leading-relaxed text-stone-500">
                  {opportunity.declineOutcome}
                </p>
              </div>
              {!current || !apply || !decline ? (
                <p
                  role="status"
                  className="text-xs font-medium text-amber-100 sm:col-span-3"
                >
                  {!actionsAvailable
                    ? "Refresh out-of-date opportunity evidence before making a decision."
                    : opportunity.decisionState !== "current"
                      ? decisionMessages[opportunity.decisionState]
                      : "Admin confirmation is unavailable. Check the Admin handoff configuration."}
                </p>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
