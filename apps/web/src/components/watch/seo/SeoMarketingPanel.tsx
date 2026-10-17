"use client"

import { useId } from "react"
import { AlertTriangle, Eye, RefreshCw, ShieldCheck } from "lucide-react"

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
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-white/8 pb-6">
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
      <div className="mt-6 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <h4 className="text-base font-semibold text-white">
          How deep people watched
        </h4>
        <span className="mt-1 block text-xs text-stone-400 sm:mt-0">
          of all video starts
        </span>
      </div>
      <p className="mt-1 max-w-xl text-sm leading-relaxed text-stone-400">
        Each milestone shows how many video starts reached that point. A start
        is not necessarily a unique person.
      </p>
      {data.retention.length ? (
        <ul className="mt-5 space-y-5">
          {data.retention.map((milestone, index) => {
            const measured =
              milestone.percentOfStarts != null &&
              Number.isFinite(milestone.percentOfStarts) &&
              milestone.percentOfStarts >= 0 &&
              milestone.percentOfStarts <= 100
            return (
              <li
                key={index}
                className="grid grid-cols-[3.25rem_1fr] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[3.5rem_1fr_auto]"
              >
                <span className="font-semibold text-white tabular-nums">
                  {displayNumber(milestone.percentWatched)}%
                  <span className="sr-only"> of the video</span>
                </span>
                <div className="col-start-2 row-start-1">
                  <div
                    role="meter"
                    aria-label={`Starts reaching ${milestone.percentWatched}% of the video`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={
                      measured ? milestone.percentOfStarts! : undefined
                    }
                    aria-valuetext={
                      measured
                        ? `${displayNumber(milestone.percentOfStarts)}% of starts`
                        : "Unavailable"
                    }
                    className="h-2.5 overflow-hidden rounded-full bg-white/8"
                  >
                    {measured ? (
                      <div
                        className="h-full rounded-full bg-[#6e91ff]"
                        style={{ width: `${milestone.percentOfStarts}%` }}
                      />
                    ) : null}
                  </div>
                </div>
                <span className="col-start-2 text-xs text-stone-400 sm:col-start-3 sm:row-start-1 sm:text-right">
                  {milestone.viewers != null && data.starts != null
                    ? `${displayNumber(milestone.viewers)} of ${displayNumber(data.starts)} starts · ${displayNumber(milestone.percentOfStarts)}%`
                    : "Unavailable"}
                </span>
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
        "w-full min-w-0 border-t border-white/10 py-8 font-sans text-stone-100 [overflow-wrap:anywhere] sm:py-10",
        seoFocusClass,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-white/10 pb-7">
        <div
          id={`${prefix}-overview`}
          className="min-w-0 max-w-3xl scroll-mt-24"
        >
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-red-200/80 uppercase">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Admin view · private
          </div>
          <h2 className="text-3xl leading-none font-semibold tracking-[-0.035em] text-white sm:text-5xl">
            SEO &amp; Marketing
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-stone-300">
            How people discover, watch, and act on this film — plus the next
            changes worth testing.
          </p>
          {data ? (
            <p className="mt-3 truncate text-xs text-stone-400">
              <span className="font-semibold text-stone-200">
                {data.page.title}
              </span>
              {" · "}
              {data.page.language}
              {" · "}
              {data.page.canonicalUrl}
            </p>
          ) : null}
        </div>
        {data && onRetry ? (
          <button
            type="button"
            className={cn(
              seoActionClass,
              "gap-2 border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white",
            )}
            onClick={onRetry}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
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
        <div className="mt-4 space-y-8">
          <nav
            aria-label="SEO evidence sections"
            className="sticky top-[76px] z-10 flex gap-1 overflow-x-auto border-b border-white/10 bg-stone-900/95 py-2 text-sm backdrop-blur-md"
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
                  "shrink-0 rounded-full px-3 py-2 text-stone-300 transition-colors hover:bg-white/8 hover:text-white",
                  seoFocusClass,
                )}
              >
                {label}
              </a>
            ))}
          </nav>
          <div id={`${prefix}-search`} className="scroll-mt-24">
            <SeoFamily
              name="rankings"
              title="Search visibility"
              description="Where this page appeared in Google Search over the last 28 days, and how often searchers chose it."
              family={data.rankings}
              className="border-white/15 bg-[#15191f]"
            >
              {(rankings) => <RankingHistory data={rankings} />}
            </SeoFamily>
          </div>
          {data.alerts.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {data.alerts.map((alert) => (
                <div
                  key={alert.id}
                  role={alert.severity === "info" ? "status" : "alert"}
                  className={cn(
                    "flex gap-3 rounded-xl border p-4 text-sm leading-relaxed",
                    alert.severity === "error"
                      ? "border-red-300/50 bg-red-950/30 text-red-100"
                      : alert.severity === "warning"
                        ? "border-amber-300/40 bg-amber-950/20 text-amber-100"
                        : "border-stone-500 text-stone-200",
                  )}
                >
                  {alert.severity === "info" ? (
                    <Eye
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <div>
                    <p className="font-semibold">{alert.title}</p>
                    <p className="mt-1 opacity-80">{alert.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div
            id={`${prefix}-audience`}
            className="grid scroll-mt-24 gap-6 lg:grid-cols-2"
          >
            <SeoFamily
              name="reach"
              title="Search reach"
              description="Visits to this page and discovery through video search. Google Search totals are summarized above."
              family={data.reach}
              className="bg-[#171a18]"
            >
              {(reach) => (
                <dl className="grid grid-cols-2 gap-5">
                  <Metric label="Page views" value={reach.pageViews} />
                  <Metric label="Visitors" value={reach.visitors} />
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
              className="lg:col-span-2"
            >
              {(viewing) => <VideoPerformance data={viewing} />}
            </SeoFamily>
            <SeoFamily
              name="ctaOutcomes"
              title="Calls to action"
              description="A click shows intent. A completed action needs its own measurement and attribution."
              family={data.ctaOutcomes}
              className="lg:col-span-2"
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
              className="bg-[#18171b] lg:col-start-2 lg:row-start-1"
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
                          ? "Stored direct HTTP observation"
                          : crawler.renderingMode === "rendered"
                            ? "Browser-rendered observation"
                            : "Unknown — rendering mode was not recorded"}
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
