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
    <div className="space-y-5">
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
            className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#111110]"
          >
            <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-red/15 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-red-200 uppercase">
                    Recommended test
                  </span>
                  <span className="text-xs text-stone-400">
                    {opportunity.confidence} confidence
                  </span>
                </div>
                <h4 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  {opportunity.title}
                </h4>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-300">
                  {opportunity.evidence}
                </p>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-stone-400 uppercase">
                      Why it matters
                    </dt>
                    <dd className="mt-1.5 leading-relaxed text-stone-200">
                      {opportunity.expectedImpact}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold tracking-wide text-stone-400 uppercase">
                      What will happen
                    </dt>
                    <dd className="mt-1.5 leading-relaxed text-stone-200">
                      {opportunity.actionSummary}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="space-y-4 border-t border-white/8 pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
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
            </div>
            <div className="grid gap-4 border-t border-white/10 bg-white/[0.025] p-5 sm:grid-cols-2 sm:p-6">
              <div className="min-w-0">
                {apply ? (
                  <a
                    className={cn(
                      seoActionClass,
                      "w-full bg-brand-red font-semibold text-white hover:bg-red-700",
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
                    className={cn(
                      seoActionClass,
                      "w-full border-white/20 bg-transparent text-white disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    Decline
                  </button>
                )}
                <p className="mt-2 text-sm leading-relaxed text-stone-300">
                  {opportunity.declineOutcome}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-stone-400 sm:col-span-2">
                Both actions open Admin confirmation in a new tab. Applying may
                create a draft or ticket; it never publishes or deploys
                directly. Declining records a decision after confirmation.
              </p>
              {!current || !apply || !decline ? (
                <p
                  role="status"
                  className="text-sm font-medium text-amber-100 sm:col-span-2"
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
