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
    <div className="space-y-6">
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
            className="min-w-0 border-l-2 border-brand-red pl-4 sm:pl-6"
          >
            <h4 className="text-lg font-semibold text-stone-100">
              {opportunity.title}
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-stone-200">
              {opportunity.evidence}
            </p>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-stone-100">
                  Expected impact
                </dt>
                <dd className="mt-1 text-stone-300">
                  {opportunity.expectedImpact}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-100">Confidence</dt>
                <dd className="mt-1 text-stone-300">
                  {opportunity.confidence}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-stone-100">
                  Proposed action
                </dt>
                <dd className="mt-1 text-stone-300">
                  {opportunity.actionSummary}
                </dd>
              </div>
            </dl>
            <div className="mt-4 space-y-4 rounded-lg bg-stone-800/60 p-4">
              {opportunity.ctaEvidence.length ? (
                opportunity.ctaEvidence.map((family, index) => {
                  const cta = displayableData(family)
                  return (
                    <div key={index} className="space-y-3 text-stone-200">
                      <AvailabilityBadge state={family.state} />
                      {cta ? (
                        <CtaOutcome cta={cta} />
                      ) : (
                        <p className="text-sm">
                          CTA click and outcome evidence: Unavailable.
                        </p>
                      )}
                      <EvidenceProvenance family={family} />
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-stone-300">
                  CTA click and outcome evidence: Unavailable. No measured
                  outcome is implied by this recommendation.
                </p>
              )}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                {apply ? (
                  <a
                    className={cn(
                      seoActionClass,
                      "w-full bg-brand-red text-xl font-bold text-white hover:bg-red-700 sm:text-xl",
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
                    className={cn(seoActionClass, "w-full disabled:opacity-50")}
                  >
                    Apply
                  </button>
                )}
                <p className="mt-2 text-sm leading-relaxed text-stone-300">
                  {opportunity.applyOutcome}
                </p>
              </div>
              <div className="min-w-0">
                {decline ? (
                  <a
                    className={cn(
                      seoActionClass,
                      "w-full border-stone-500 bg-transparent text-stone-100 hover:bg-stone-700",
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
                    className={cn(seoActionClass, "w-full disabled:opacity-50")}
                  >
                    Decline
                  </button>
                )}
                <p className="mt-2 text-sm leading-relaxed text-stone-300">
                  {opportunity.declineOutcome}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-stone-300">
              Both actions open Admin confirmation in a new tab. Applying may
              create a draft or ticket; it never publishes or deploys directly.
              Declining records a decision after confirmation.
            </p>
            {!current || !apply || !decline ? (
              <p
                role="status"
                className="mt-3 text-sm font-medium text-amber-100"
              >
                {!actionsAvailable
                  ? "Refresh out-of-date opportunity evidence before making a decision."
                  : opportunity.decisionState !== "current"
                    ? decisionMessages[opportunity.decisionState]
                    : "Admin confirmation is unavailable. Check the Admin handoff configuration."}
              </p>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
