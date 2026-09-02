import type { Route } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { firstSearchParam } from "@/app/dashboard/video-library-utils"
import { PageSection, StatusPill } from "@/components/admin-ui"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import {
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
  loadRecommendationPlaybackContextDetail,
  recommendationTraceActorDigest,
  type RecommendationPlaybackFactDetail,
} from "@/services/recommendations/admin-ops"
import {
  displayRecommendationToken,
  formatRecommendationDateTime,
} from "../../recommendation-display"

type RecommendationPlaybackContextPageProps = {
  params: Promise<{ contextId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function RecommendationPlaybackContextPage({
  params,
  searchParams,
}: RecommendationPlaybackContextPageProps) {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-traces")) {
    redirect("/dashboard/recommendations")
  }
  if (!principal.id) redirect("/dashboard/recommendations")
  const { contextId } = await params
  const query = (await searchParams) ?? {}
  const window = firstSearchParam(query.window)
  const detail = await loadRecommendationPlaybackContextDetail(prisma, {
    contextId,
    actorDigest: recommendationTraceActorDigest(
      principal.id,
      env.ADMIN_SESSION_SECRET,
    ),
  })
  if (!detail) notFound()
  const backQuery = new URLSearchParams()
  if (window === "7d" || window === "29d" || window === "24h") {
    backQuery.set("window", window)
  }
  const backHref = `/dashboard/recommendations${backQuery.size ? `?${backQuery.toString()}` : ""}`
  const { context, facts, outcomes, audits, conflicts } = detail

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb">
        <Link
          href={backHref as Route}
          className="inline-flex items-center gap-1 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Recommendations
        </Link>
      </nav>
      <header>
        <div className="label-text">Privacy-safe playback trace</div>
        <h1 className="mt-1 break-all text-2xl font-semibold">{context.id}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          {`Access is recorded in the sanitized ${RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS}-day operator audit. Viewer identity, URLs, digests, tokens, capabilities, and raw payloads are excluded.`}
        </p>
      </header>

      <PageSection title="Context" meta="SOURCE IS DIAGNOSTIC ONLY">
        <dl className="grid gap-px bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-4">
          <Definition label="Source" value={context.source} />
          <Definition label="Media" value={context.mediaId} />
          <Definition
            label="Recommendation attribution"
            value={context.recommendationAttributed ? "Present" : "Absent"}
          />
          <Definition
            label="Source reference"
            value={context.sourceReferencePresent ? "Present" : "Absent"}
          />
          <Definition label="Generation" value={String(context.generation)} />
          <Definition
            label="Created"
            value={formatRecommendationDateTime(context.createdAt)}
          />
          <Definition
            label="Expires"
            value={formatRecommendationDateTime(context.expiresAt)}
          />
          <Definition
            label="Integrity"
            value={`${context.conflicts} conflicts · ${context.writeFailures} write failures`}
          />
        </dl>
      </PageSection>

      <PageSection title="Episode lifecycle" meta="BOUNDED CHRONOLOGY">
        {context.episode ? (
          <div className="space-y-4 px-4 py-5 text-[13px]">
            <StatusPill
              tone={
                context.episode.state === "finalized"
                  ? "success"
                  : context.episode.state === "timed_out"
                    ? "warning"
                    : "muted"
              }
            >
              {displayRecommendationToken(context.episode.state)}
            </StatusPill>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Definition
                label="Claimed"
                value={formatRecommendationDateTime(context.episode.claimedAt)}
              />
              <Definition
                label="Finalized"
                value={formatRecommendationDateTime(
                  context.episode.finalizedAt,
                )}
              />
              <Definition
                label="Active deadline"
                value={formatRecommendationDateTime(
                  context.episode.activeUntil,
                )}
              />
              <Definition
                label="Hard deadline"
                value={formatRecommendationDateTime(context.episode.hardUntil)}
              />
            </dl>
          </div>
        ) : (
          <p className="px-4 py-5 text-[13px] text-[var(--color-text-muted)]">
            No active episode is retained for this context.
          </p>
        )}
      </PageSection>

      <PageSection
        title="Playback facts"
        meta={`${facts.length} SANITIZED EVENTS`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
                <th className="px-4 py-2 font-medium">Sequence</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Occurred</th>
                <th className="px-4 py-2 font-medium">Bounded metrics</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((fact) => (
                <tr
                  key={fact.sequence}
                  className="border-b border-[var(--color-hairline)] align-top"
                >
                  <td className="px-4 py-3 font-mono">{fact.sequence}</td>
                  <td className="px-4 py-3">
                    {displayRecommendationToken(fact.kind)}
                    {fact.late ? " · Late" : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px]">
                    {formatRecommendationDateTime(fact.occurredAt)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[var(--color-text-muted)]">
                    {factMetrics(fact)}
                  </td>
                </tr>
              ))}
              {facts.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                  >
                    No retained playback facts.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection
        title="Outcome revisions"
        meta={`${outcomes.length} IMMUTABLE REVISIONS`}
      >
        <div className="grid gap-3 px-4 py-5 lg:grid-cols-2">
          {outcomes.map((outcome) => (
            <article
              key={`${outcome.classifierVersion}:${outcome.revision}`}
              className="border border-[var(--color-hairline)] bg-[var(--color-surface)] p-4 text-[12px]"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">
                  {outcome.classifierVersion} · revision {outcome.revision}
                </h3>
                <StatusPill tone={outcome.qualifiedView ? "success" : "muted"}>
                  {outcome.qualifiedView ? "Qualified" : "Not qualified"}
                </StatusPill>
              </div>
              <p className="mt-3 text-[var(--color-text-muted)]">
                {`${outcome.activePlaybackMilliseconds ?? "Unknown"} active ms · ${outcome.durationSeconds ?? "Unknown"} duration s · ${outcome.durationCohort ?? "Unknown cohort"} · ${outcome.activeCoverage ?? "Unknown coverage"}`}
              </p>
              <p className="mt-2">
                Eligibility: {outcome.eligibility?.state ?? "Pending"} · weight{" "}
                {outcome.eligibility?.contributionWeight ?? "—"}
              </p>
              <p className="mt-2 text-[var(--color-text-muted)]">
                Reasons: {outcome.reasons.join(", ") || "None"}
              </p>
            </article>
          ))}
          {outcomes.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">
              No retained outcome revisions.
            </p>
          ) : null}
        </div>
      </PageSection>

      <PageSection title="Operational evidence" meta="SANITIZED COUNTERS ONLY">
        <div className="grid gap-4 px-4 py-5 text-[12px] sm:grid-cols-2">
          <div>
            <h3 className="label-text">Audits</h3>
            <ul className="mt-2 space-y-1">
              {audits.map((audit, index) => (
                <li key={`${audit.occurredAt.toISOString()}:${index}`}>
                  {displayRecommendationToken(audit.kind)} · {audit.reasonCode}{" "}
                  · {audit.count}
                </li>
              ))}
              {audits.length === 0 ? <li>None</li> : null}
            </ul>
          </div>
          <div>
            <h3 className="label-text">Conflicts</h3>
            <ul className="mt-2 space-y-1">
              {conflicts.map((conflict, index) => (
                <li key={`${conflict.firstSeenAt.toISOString()}:${index}`}>
                  {conflict.attempts} attempts · last{" "}
                  {formatRecommendationDateTime(conflict.lastSeenAt)}
                </li>
              ))}
              {conflicts.length === 0 ? <li>None</li> : null}
            </ul>
          </div>
        </div>
      </PageSection>
    </div>
  )
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <dt className="label-text">{label}</dt>
      <dd className="mt-1 break-all font-mono text-[12px] text-[var(--color-text-secondary)]">
        {value}
      </dd>
    </div>
  )
}

function factMetrics(fact: RecommendationPlaybackFactDetail): string {
  const values = [
    fact.positionSeconds == null ? null : `position ${fact.positionSeconds}s`,
    fact.durationSeconds == null ? null : `duration ${fact.durationSeconds}s`,
    fact.fromSeconds == null ? null : `from ${fact.fromSeconds}s`,
    fact.toSeconds == null ? null : `to ${fact.toSeconds}s`,
    fact.activeMilliseconds == null
      ? null
      : `active ${fact.activeMilliseconds}ms`,
    fact.startedAt && fact.endedAt
      ? `interval ${fact.startedAt} → ${fact.endedAt}`
      : null,
  ].filter(Boolean)
  return values.join(" · ") || "No metric fields"
}
