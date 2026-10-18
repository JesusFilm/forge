"use client"

import { useId } from "react"
import { RefreshCw, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"

import { OpportunityList } from "./OpportunityList"
import { PreviewWidgets } from "./PreviewWidgets"
import { RankingHistory } from "./RankingHistory"
import {
  CtaOutcome,
  displayDate,
  displayNumber,
  displayableData,
  Metric,
  SeoFamily,
  seoActionClass,
  seoFocusClass,
} from "./presentation"
import type { SeoMarketingPanelProps, ViewingEvidence } from "./types"

function VideoPerformance({ data }: { data: ViewingEvidence }) {
  return (
    <div className="grid gap-0 overflow-hidden rounded-lg border border-stone-200 bg-white md:grid-cols-[17rem_1fr]">
      <div className="border-b border-stone-200 bg-stone-50 p-5 md:border-r md:border-b-0">
        <p className="text-[10px] font-bold tracking-[0.16em] text-stone-500 uppercase">
          Video performance
        </p>
        <p className="mt-2 text-4xl font-bold tracking-[-0.05em] text-stone-950 tabular-nums">
          {displayNumber(data.averageWatchedPercent, "%")}
        </p>
        <h4 className="mt-1 font-semibold text-stone-950">
          watched on average
        </h4>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-stone-200 pt-4">
          <Metric label="Started" value={data.starts} />
          <Metric label="Completed" value={data.completions} />
        </dl>
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-stone-950">
              How deep people watch
            </h4>
            <p className="mt-1 text-[11px] text-stone-500">
              Starts reaching each milestone
            </p>
          </div>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-800">
            {displayNumber(data.starts)} starters
          </span>
        </div>
        {data.retention.length ? (
          <>
            <ul className="mt-4 space-y-2.5">
              {data.retention.map((milestone, index) => {
                const measured =
                  milestone.percentOfStarts != null &&
                  Number.isFinite(milestone.percentOfStarts) &&
                  milestone.percentOfStarts >= 0 &&
                  milestone.percentOfStarts <= 100
                return (
                  <li
                    key={index}
                    className="grid grid-cols-[3.25rem_1fr_7rem] items-center gap-3 text-[11px]"
                  >
                    <span className="font-semibold text-stone-950 tabular-nums">
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
                        className="h-3 overflow-hidden rounded-full bg-stone-200"
                      >
                        {measured ? (
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-red to-orange-400"
                            style={{ width: `${milestone.percentOfStarts}%` }}
                          />
                        ) : null}
                      </div>
                    </div>
                    <span className="text-right text-[10px] text-stone-500 tabular-nums">
                      {milestone.viewers != null && data.starts != null
                        ? `${displayNumber(milestone.viewers)} of ${displayNumber(data.starts)} starts · ${displayNumber(milestone.percentOfStarts)}%`
                        : "Unavailable"}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-4 text-[10px] leading-relaxed text-stone-500">
              Directional milestones; starts are not necessarily unique people.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-stone-700">
            Watch-depth milestones unavailable.
          </p>
        )}
      </div>
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
  const rankings = data ? displayableData(data.rankings) : null
  const reach = data ? displayableData(data.reach) : null
  const viewing = data ? displayableData(data.viewing) : null
  const aiTraffic = data ? displayableData(data.aiTraffic) : null
  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={0}
      aria-busy={state.status === "loading"}
      data-dd-privacy="mask"
      className={cn(
        "w-full min-w-0 scroll-mt-28 border-t border-stone-200 bg-[#f8f7f3] px-4 py-7 font-sans text-stone-900 [overflow-wrap:anywhere] sm:scroll-mt-24 sm:px-6 sm:py-8 lg:px-8",
        seoFocusClass,
      )}
    >
      <div className="rounded-[10px] border border-stone-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
        <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600">
          <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
          <strong className="text-stone-950">Private page intelligence</strong>
          <span>Only signed-in admins see this tab</span>
          <span className="ml-auto text-emerald-700">● Live page</span>
        </div>
      </div>
      <div className="mt-7 flex flex-wrap items-end justify-between gap-5 border-b border-stone-200 pb-5">
        <div
          id={`${prefix}-overview`}
          className="min-w-0 max-w-3xl scroll-mt-24"
        >
          <div className="mb-2 text-[10px] font-bold tracking-[0.16em] text-stone-500 uppercase">
            SEO &amp; marketing
          </div>
          <h2 className="text-2xl leading-none font-semibold tracking-[-0.025em] text-stone-950 sm:text-3xl">
            How people discover and use this page
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600">
            Search reach, video viewing, sharing, AI referrals and the next
            changes worth testing—all tied to stored evidence.
          </p>
          {data ? (
            <p className="mt-3 truncate text-xs text-stone-500">
              <span className="font-semibold text-stone-800">
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
              "gap-2 border-stone-300 bg-white text-stone-900 hover:bg-stone-100 hover:text-stone-950",
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
              <p className="mt-2 text-sm text-stone-600">
                Search, audience and crawler observations will appear here.
              </p>
            </div>
          ) : state.status === "error" ? (
            <div role="alert">
              <p className="font-semibold">Evidence could not be loaded</p>
              <p className="mt-2 text-sm text-stone-600">
                Try again to request the latest stored evidence.
              </p>
            </div>
          ) : (
            <div role="status">
              <p className="font-semibold">
                No evidence is available for this page yet
              </p>
              <p className="mt-2 text-sm text-stone-600">
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
        <div className="mt-4 space-y-6">
          <nav
            aria-label="SEO evidence sections"
            className="flex items-center gap-5 overflow-x-auto border-y border-stone-200 py-3 text-[11px]"
          >
            <span className="shrink-0 font-semibold tracking-[0.14em] text-stone-500 uppercase">
              Sections
            </span>
            {[
              ["overview", "Overview"],
              ["search", "Search"],
              ["audience", "Audience"],
              ["content", "Content & crawlers"],
              ["previews", "Previews"],
              ["opportunities", "Opportunities"],
            ].map(([anchor, label], index) => (
              <a
                key={anchor}
                href={`#${prefix}-${anchor}`}
                className={cn(
                  "group flex shrink-0 items-center gap-2 py-1 font-semibold text-stone-500 transition-colors hover:text-stone-950",
                  index === 0 && "text-stone-950",
                  seoFocusClass,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full bg-transparent transition-colors group-hover:bg-brand-red",
                    index === 0 && "bg-brand-red",
                  )}
                />
                {label}
              </a>
            ))}
          </nav>
          <dl className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)] sm:grid-cols-3 lg:grid-cols-5">
            {[
              ["Seen in Google", rankings?.impressions, "search appearances"],
              ["Search visits", rankings?.clicks, "Search Console"],
              ["Page views", reach?.pageViews, "Google Analytics"],
              ["Video starts", viewing?.starts, "watch activity"],
              ["AI referrals", aiTraffic?.visits, "known minimum"],
            ].map(([label, value, note]) => (
              <div
                key={String(label)}
                className="border-r border-b border-stone-200 p-4 even:border-r-0 last:col-span-2 last:border-b-0 sm:even:border-r sm:last:col-span-1 lg:last:border-r-0"
              >
                <dt className="text-[10px] text-stone-400">{label}</dt>
                <dd className="mt-1 text-xl font-bold text-stone-950 tabular-nums">
                  {displayNumber(value as number | null | undefined)}
                </dd>
                <dd className="mt-0.5 text-[9px] text-stone-500">{note}</dd>
              </div>
            ))}
          </dl>
          <div
            id={`${prefix}-search`}
            className="grid scroll-mt-36 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(16rem,.75fr)]"
          >
            <SeoFamily
              name="rankings"
              title="Usually visible on Google’s first page"
              description="Average search position over the supplied reporting window."
              family={data.rankings}
              className="border-stone-200 bg-white"
            >
              {(rankingData) => <RankingHistory data={rankingData} />}
            </SeoFamily>
            <aside className="overflow-hidden rounded-[10px] border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
              <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
                <div>
                  <h3 className="font-semibold text-stone-950">Warnings</h3>
                  <p className="text-[10px] text-stone-500">
                    Ordered by consequence
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-800">
                  {data.alerts.length} items
                </span>
              </div>
              {data.alerts.length ? (
                data.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    role={alert.severity === "info" ? "status" : "alert"}
                    className="grid grid-cols-[8px_1fr] gap-2.5 border-b border-stone-200 px-4 py-3 last:border-b-0"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 rounded-full",
                        alert.severity === "error"
                          ? "bg-brand-red"
                          : alert.severity === "warning"
                            ? "bg-amber-300"
                            : "bg-blue-300",
                      )}
                    />
                    <div>
                      <p className="text-xs font-semibold text-stone-950">
                        {alert.title}
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-stone-600">
                        {alert.detail}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-4 text-xs text-stone-600">
                  No active warnings.
                </p>
              )}
            </aside>
          </div>
          <div
            id={`${prefix}-audience`}
            className="grid scroll-mt-36 gap-6 lg:grid-cols-2"
          >
            <SeoFamily
              name="reach"
              title="Search reach"
              description="Visits to this page and discovery through video search. Google Search totals are summarized above."
              family={data.reach}
              className="bg-white"
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
                  <div className="grid overflow-hidden rounded-lg border border-stone-200 sm:grid-cols-2 lg:grid-cols-3">
                    {outcomes.items.map((cta) => (
                      <div
                        key={cta.id}
                        className="border-b border-stone-200 p-3 sm:border-r"
                      >
                        <CtaOutcome cta={cta} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-stone-700">
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
              className="bg-white lg:col-start-2 lg:row-start-1"
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
                    <p className="mt-4 text-sm text-stone-700">
                      Assistant breakdown unavailable.
                    </p>
                  )}
                </div>
              )}
            </SeoFamily>
          </div>
          <div
            id={`${prefix}-content`}
            className="grid scroll-mt-36 gap-6 lg:grid-cols-2"
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
                        <dd className="mt-1 text-stone-700">
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
                                ? "font-semibold text-amber-800"
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
                          <p className="mt-1 text-stone-700">{check.detail}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm text-stone-700">
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
                      <dd className="mt-1 text-stone-700">
                        {crawler.renderingMode === "direct_http"
                          ? "Stored direct HTTP observation"
                          : crawler.renderingMode === "rendered"
                            ? "Browser-rendered observation"
                            : "Unknown — rendering mode was not recorded"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Bot visits</dt>
                      <dd className="mt-1 text-stone-700">
                        {displayNumber(crawler.botVisits)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Last bot visit</dt>
                      <dd className="mt-1 text-stone-700">
                        {displayDate(crawler.lastVisitAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Caching</dt>
                      <dd className="mt-1 text-stone-700">
                        {crawler.cacheStatus || "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">
                        Search indexing evidence
                      </dt>
                      <dd className="mt-1 text-stone-700">
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
                    <p className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-stone-100 p-3 leading-relaxed whitespace-pre-wrap">
                      {crawler.textExcerpt || "Observed text unavailable."}
                    </p>
                  </details>
                  {crawler.notes.length ? (
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-stone-700">
                      {crawler.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </SeoFamily>
          </div>
          <div id={`${prefix}-previews`} className="scroll-mt-36">
            <SeoFamily
              name="previews"
              title="Link previews"
              description="How the current page metadata could look when shared."
              family={data.previews}
            >
              {(previews) => <PreviewWidgets data={previews} />}
            </SeoFamily>
          </div>
          <div id={`${prefix}-opportunities`} className="scroll-mt-36">
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
