"use client"

import { useId } from "react"

import { cn } from "@/lib/utils"

import { OpportunityList } from "./OpportunityList"
import { PreviewWidgets } from "./PreviewWidgets"
import { RankingHistory } from "./RankingHistory"
import {
  CtaOutcome,
  displayDate,
  displayNumber,
  Metric,
  SeoFamily,
  seoActionClass,
  seoFocusClass,
} from "./presentation"
import type { SeoMarketingPanelProps, ViewingEvidence } from "./types"

function VideoPerformance({ data }: { data: ViewingEvidence }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-5">
        <Metric label="Video starts" value={data.starts} />
        <Metric label="Completions" value={data.completions} />
        <Metric
          label="Average video watched"
          value={data.averageWatchedPercent}
          suffix="%"
        />
        <Metric
          label="Completion rate"
          value={data.completionRatePercent}
          suffix="%"
        />
      </dl>
      <h4 className="mt-6 text-base font-semibold text-stone-100">
        How deep people watched
      </h4>
      <p className="mt-1 text-sm leading-relaxed text-stone-300">
        Each milestone shows how many video starts reached that point. A start
        is not necessarily a unique person.
      </p>
      {data.retention.length ? (
        <ul className="mt-4 space-y-4">
          {data.retention.map((milestone, index) => {
            const measured =
              milestone.percentOfStarts != null &&
              Number.isFinite(milestone.percentOfStarts) &&
              milestone.percentOfStarts >= 0 &&
              milestone.percentOfStarts <= 100
            return (
              <li key={index} className="space-y-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    {displayNumber(milestone.percentWatched)}% of the video
                  </span>
                  <span className="text-stone-300 tabular-nums">
                    {milestone.viewers != null && data.starts != null
                      ? `${displayNumber(milestone.viewers)} of ${displayNumber(data.starts)} starts`
                      : "Viewers: Unavailable"}
                  </span>
                </div>
                {measured ? (
                  <div
                    role="meter"
                    aria-label={`Starts reaching ${milestone.percentWatched}% of the video`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={milestone.percentOfStarts!}
                    aria-valuetext={`${displayNumber(milestone.percentOfStarts)}% of starts`}
                    className="h-2 overflow-hidden rounded-full bg-stone-700"
                  >
                    <div
                      className="h-full rounded-full bg-brand-red"
                      style={{ width: `${milestone.percentOfStarts}%` }}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-stone-300">
                    Retention: Unavailable
                  </p>
                )}
                {measured ? (
                  <p className="text-xs text-stone-300">
                    {displayNumber(milestone.percentOfStarts)}% of starts
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-stone-300">
          Watch-depth milestones unavailable.
        </p>
      )}
    </div>
  )
}

/** Presentational only. The parent owns Admin capability, deferred import and reads. */
export function SeoMarketingPanel({
  id,
  labelledBy,
  state,
  adminOrigin,
  adminConfirmationUrl,
  onRetry,
}: SeoMarketingPanelProps) {
  const prefix = useId()
  const data = state.status === "ready" ? state.data : null
  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={0}
      aria-busy={state.status === "loading"}
      data-dd-privacy="mask"
      className={cn(
        "w-full min-w-0 border-t border-stone-600/60 py-8 font-sans text-stone-100 [overflow-wrap:anywhere]",
        seoFocusClass,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold sm:text-3xl">
            SEO &amp; Marketing
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-300">
            See how people find and watch this video, then review what could
            help. Private evidence for administrators.
          </p>
        </div>
        {data && onRetry ? (
          <button type="button" className={seoActionClass} onClick={onRetry}>
            Refresh evidence
          </button>
        ) : null}
      </div>
      {!data ? (
        <div className="mt-6 flex min-h-80 flex-col items-start justify-center gap-4 rounded-2xl border border-stone-600/60 p-6">
          {state.status === "loading" ? (
            <div role="status">
              <p className="font-semibold">Loading stored evidence…</p>
              <p className="mt-2 text-sm text-stone-300">
                Search, audience and crawler observations will appear here.
              </p>
            </div>
          ) : state.status === "error" ? (
            <div role="alert">
              <p className="font-semibold">Evidence could not be loaded</p>
              <p className="mt-2 text-sm text-stone-300">
                Try again to request the latest stored evidence.
              </p>
            </div>
          ) : (
            <div role="status">
              <p className="font-semibold">
                No evidence is available for this page yet
              </p>
              <p className="mt-2 text-sm text-stone-300">
                Missing observations do not mean zero traffic or no
                opportunities.
              </p>
            </div>
          )}
          {state.status !== "loading" && onRetry ? (
            <button type="button" onClick={onRetry} className={seoActionClass}>
              Try again
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div
            id={`${prefix}-overview`}
            className="min-w-0 space-y-2 border-l-2 border-stone-500 pl-4 text-sm leading-relaxed"
          >
            <p className="font-semibold">
              {data.page.title}{" "}
              <span className="font-normal text-stone-300">
                ({data.page.language})
              </span>
            </p>
            <p className="text-stone-300">
              Search canonical:{" "}
              <span className="break-all text-stone-100">
                {data.page.canonicalUrl}
              </span>
            </p>
            {data.page.contextualUrl ? (
              <p className="text-stone-300">
                Viewing context:{" "}
                <span className="break-all">{data.page.contextualUrl}</span>
              </p>
            ) : null}
          </div>
          <nav
            aria-label="SEO evidence sections"
            className="flex flex-wrap gap-x-5 gap-y-2 border-b border-stone-600/60 pb-4 text-sm"
          >
            {[
              ["overview", "Overview"],
              ["search", "Search"],
              ["audience", "Audience"],
              ["content", "Content & crawlers"],
              ["previews", "Previews"],
              ["opportunities", "Opportunities"],
            ].map(([anchor, label]) => (
              <a
                key={anchor}
                href={`#${prefix}-${anchor}`}
                className={cn(
                  "py-2 underline decoration-stone-500 underline-offset-4 hover:text-red-200",
                  seoFocusClass,
                )}
              >
                {label}
              </a>
            ))}
          </nav>
          {data.alerts.length ? (
            <div className="space-y-3">
              {data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  role={alert.severity === "info" ? "status" : "alert"}
                  className={cn(
                    "rounded-xl border p-4 text-sm leading-relaxed",
                    alert.severity === "error"
                      ? "border-red-300/50 bg-red-950/30 text-red-100"
                      : alert.severity === "warning"
                        ? "border-amber-300/40 bg-amber-950/20 text-amber-100"
                        : "border-stone-500 text-stone-200",
                  )}
                >
                  <p className="font-semibold">{alert.title}</p>
                  <p className="mt-1">{alert.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div id={`${prefix}-search`} className="scroll-mt-24">
            <SeoFamily
              name="rankings"
              title="Search ranking history"
              description="Where this page appeared in search results over time. These are page-level averages; detailed search queries stay in Admin."
              family={data.rankings}
            >
              {(rankings) => <RankingHistory data={rankings} />}
            </SeoFamily>
          </div>
          <div
            id={`${prefix}-audience`}
            className="grid scroll-mt-24 gap-6 lg:grid-cols-2"
          >
            <SeoFamily
              name="reach"
              title="Search reach"
              description="How often people saw or visited this page. Search, video search and on-page visits remain separate measurements."
              family={data.reach}
            >
              {(reach) => (
                <dl className="grid grid-cols-2 gap-5">
                  <Metric label="Page views" value={reach.pageViews} />
                  <Metric label="Visitors" value={reach.visitors} />
                  <Metric label="Search clicks" value={reach.searchClicks} />
                  <Metric
                    label="Search appearances"
                    value={reach.searchImpressions}
                  />
                  <Metric
                    label="Video-search clicks"
                    value={reach.videoSearchClicks}
                  />
                  <Metric
                    label="Video-search appearances"
                    value={reach.videoSearchImpressions}
                  />
                </dl>
              )}
            </SeoFamily>
            <SeoFamily
              name="viewing"
              title="Video performance"
              description="Starts, completions and watch depth from the supplied video observations."
              family={data.viewing}
            >
              {(viewing) => <VideoPerformance data={viewing} />}
            </SeoFamily>
            <SeoFamily
              name="ctaOutcomes"
              title="Calls to action"
              description="A click shows intent. A completed action needs its own measurement and attribution."
              family={data.ctaOutcomes}
            >
              {(outcomes) =>
                outcomes.items.length ? (
                  <div className="space-y-5 divide-y divide-stone-600/50">
                    {outcomes.items.map((cta) => (
                      <div key={cta.id} className="pt-3 first:pt-0">
                        <CtaOutcome cta={cta} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-stone-300">
                    CTA click and outcome evidence unavailable.
                  </p>
                )
              }
            </SeoFamily>
            <SeoFamily
              name="aiTraffic"
              title="AI-assistant traffic"
              description="Recorded visits attributed to an AI assistant. Referral traffic does not prove a citation or mention in an answer."
              family={data.aiTraffic}
            >
              {(traffic) => (
                <div>
                  <dl>
                    <Metric label="Attributed visits" value={traffic.visits} />
                  </dl>
                  {traffic.assistants.length ? (
                    <dl className="mt-5 space-y-3 text-sm">
                      {traffic.assistants.map((assistant) => (
                        <div
                          key={assistant.name}
                          className="flex flex-wrap justify-between gap-3 border-b border-stone-600/50 pb-2"
                        >
                          <dt>{assistant.name}</dt>
                          <dd className="font-semibold tabular-nums">
                            {displayNumber(assistant.visits)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-4 text-sm text-stone-300">
                      Assistant breakdown unavailable.
                    </p>
                  )}
                </div>
              )}
            </SeoFamily>
          </div>
          <div
            id={`${prefix}-content`}
            className="grid scroll-mt-24 gap-6 lg:grid-cols-2"
          >
            <SeoFamily
              name="content"
              title="Content analysis"
              description="Current page metadata and stored content checks. These checks explain the page; they are not a ranking guarantee."
              family={data.content}
            >
              {(content) => (
                <div>
                  <dl className="space-y-4 text-sm">
                    {[
                      ["Page title", content.title],
                      ["Description", content.description],
                      ["Canonical URL", content.canonicalUrl],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="font-semibold">{label}</dt>
                        <dd className="mt-1 text-stone-300">
                          {value || "Unavailable"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {content.checks.length ? (
                    <ul className="mt-5 space-y-3 text-sm">
                      {content.checks.map((check, index) => (
                        <li
                          key={index}
                          className="border-t border-stone-600/50 pt-3"
                        >
                          <p
                            className={
                              check.state === "warning"
                                ? "font-semibold text-amber-100"
                                : "font-semibold"
                            }
                          >
                            {check.state === "pass"
                              ? "Checked"
                              : check.state === "warning"
                                ? "Needs attention"
                                : "Unavailable"}
                            : {check.label}
                          </p>
                          <p className="mt-1 text-stone-300">{check.detail}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm text-stone-300">
                      Content checks unavailable.
                    </p>
                  )}
                </div>
              )}
            </SeoFamily>
            <SeoFamily
              name="crawler"
              title="How bots see it"
              description="Stored crawler and delivery observations. A successful fetch, a bot visit and search indexing prove different things."
              family={data.crawler}
            >
              {(crawler) => (
                <div>
                  <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold">Rendering observation</dt>
                      <dd className="mt-1 text-stone-300">
                        {crawler.renderingMode === "direct_http"
                          ? "Direct HTTP (without browser JavaScript)"
                          : crawler.renderingMode === "rendered"
                            ? "Browser-rendered observation"
                            : "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Bot visits</dt>
                      <dd className="mt-1 text-stone-300">
                        {displayNumber(crawler.botVisits)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Last bot visit</dt>
                      <dd className="mt-1 text-stone-300">
                        {displayDate(crawler.lastVisitAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Caching</dt>
                      <dd className="mt-1 text-stone-300">
                        {crawler.cacheStatus || "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">
                        Search indexing evidence
                      </dt>
                      <dd className="mt-1 text-stone-300">
                        {crawler.indexingStatus || "Unavailable"}
                      </dd>
                    </div>
                  </dl>
                  <details className="mt-5 text-sm">
                    <summary
                      className={cn("w-fit cursor-pointer py-2", seoFocusClass)}
                    >
                      Read the observed page text
                    </summary>
                    <p className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-stone-800/60 p-3 leading-relaxed whitespace-pre-wrap">
                      {crawler.textExcerpt || "Observed text unavailable."}
                    </p>
                  </details>
                  {crawler.notes.length ? (
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-stone-300">
                      {crawler.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </SeoFamily>
          </div>
          <div id={`${prefix}-previews`} className="scroll-mt-24">
            <SeoFamily
              name="previews"
              title="Link previews"
              description="How the current page metadata could look when shared."
              family={data.previews}
            >
              {(previews) => <PreviewWidgets data={previews} />}
            </SeoFamily>
          </div>
          <div id={`${prefix}-opportunities`} className="scroll-mt-24">
            <SeoFamily
              name="opportunities"
              title="Opportunities"
              description="Review the evidence, expected impact and exact outcome before opening Admin confirmation."
              family={data.opportunities}
            >
              {(opportunities) => (
                <OpportunityList
                  items={opportunities.items}
                  adminOrigin={adminOrigin}
                  adminConfirmationUrl={adminConfirmationUrl}
                  actionsAvailable={
                    data.opportunities.state === "available" ||
                    data.opportunities.state === "partial"
                  }
                />
              )}
            </SeoFamily>
          </div>
        </div>
      )}
    </section>
  )
}
