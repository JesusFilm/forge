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
  loadPlaybackEpisodeDetail,
  recommendationTraceActorDigest,
} from "@/services/recommendations/admin-ops"
import {
  displayRecommendationToken,
  formatRecommendationDateTime,
} from "../../recommendation-display"

type PlaybackEpisodePageProps = {
  params: Promise<{ episodeId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function PlaybackEpisodePage({
  params,
  searchParams,
}: PlaybackEpisodePageProps) {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-traces")) {
    redirect("/dashboard/recommendations")
  }
  if (!principal.id) redirect("/dashboard/recommendations")
  const { episodeId } = await params
  const detail = await loadPlaybackEpisodeDetail(prisma, {
    episodeId,
    actorDigest: recommendationTraceActorDigest(
      principal.id,
      env.ADMIN_SESSION_SECRET,
    ),
  })
  if (!detail) notFound()
  const window = firstSearchParam((await searchParams)?.window)
  const backHref = `/dashboard/recommendations${window ? `?window=${encodeURIComponent(window)}` : ""}`

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb">
        <Link
          href={backHref as Route}
          className="inline-flex items-center gap-1 text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Recommendations
        </Link>
      </nav>
      <header>
        <div className="label-text">Privacy-safe playback episode</div>
        <h1 className="mt-1 break-all text-2xl font-semibold">{detail.id}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          Access is recorded in the sanitized{" "}
          {RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS}-day operator audit.
        </p>
      </header>

      <PageSection
        title="Context and fences"
        meta="SERVER-ISSUED / SOURCE-NEUTRAL"
      >
        <div className="grid gap-px bg-[var(--color-hairline)] md:grid-cols-2 lg:grid-cols-4">
          <Value label="Media" value={detail.mediaId} />
          <Value
            label="Discovery source"
            value={displayRecommendationToken(detail.discoverySource)}
          />
          <Value
            label="State / generation"
            value={`${displayRecommendationToken(detail.state)} / ${detail.generation}`}
          />
          <Value
            label="Next fact sequence"
            value={String(detail.nextFactSequence)}
          />
          <Value label="Replay count" value={String(detail.replayCount)} />
          <Value label="Conflict count" value={String(detail.conflictCount)} />
          <Value
            label="Request lineage"
            value={detail.requestId ?? "None (standalone)"}
          />
          <Value
            label="Item lineage"
            value={detail.itemId ?? "None (standalone)"}
          />
          <Value
            label="Active until"
            value={formatRecommendationDateTime(detail.activeUntil)}
          />
          <Value
            label="Hard until"
            value={formatRecommendationDateTime(detail.hardUntil)}
          />
        </div>
        <div className="border-t border-[var(--color-hairline)] p-4">
          <div className="label-text">Bounded provenance</div>
          <p className="mt-2 break-words font-mono text-[11px] text-[var(--color-text-secondary)]">
            {Object.entries(detail.provenance)
              .map(([key, value]) => `${key}=${value}`)
              .join(" · ") || "None"}
          </p>
        </div>
      </PageSection>

      <PageSection
        title="Immutable facts"
        meta={`${detail.facts.length} APPEND-ONLY ROWS`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-y border-[var(--color-hairline)] text-[var(--color-text-muted)]">
                <th className="px-4 py-2">Sequence / kind</th>
                <th className="px-4 py-2">Event / digest</th>
                <th className="px-4 py-2">Occurred / received</th>
                <th className="px-4 py-2">Bounded metrics</th>
              </tr>
            </thead>
            <tbody>
              {detail.facts.map((fact) => (
                <tr
                  key={fact.id}
                  className="border-b border-[var(--color-hairline)] align-top"
                >
                  <td className="px-4 py-3">
                    <StatusPill tone={fact.late ? "warning" : "muted"}>
                      #{fact.sequence} · {displayRecommendationToken(fact.kind)}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    <div>{fact.eventId}</div>
                    <div className="mt-1 break-all text-[var(--color-text-muted)]">
                      {fact.payloadDigest}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    <div>{formatRecommendationDateTime(fact.occurredAt)}</div>
                    <div className="mt-1 text-[var(--color-text-muted)]">
                      {formatRecommendationDateTime(fact.receivedAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    active {fact.activeMilliseconds ?? "—"} ms · coverage{" "}
                    {displayRecommendationToken(fact.activeCoverage)} · position{" "}
                    {fact.positionSeconds ?? "—"} s · duration{" "}
                    {fact.durationSeconds ?? "—"} s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection
        title="Revisioned outcomes"
        meta={`${detail.outcomes.length} IMMUTABLE ROWS`}
      >
        <div className="space-y-px bg-[var(--color-hairline)]">
          {detail.outcomes.map((outcome) => (
            <article
              key={outcome.id}
              className="bg-[var(--color-surface)] p-4 text-[12px]"
            >
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={outcome.qualifiedView ? "success" : "muted"}>
                  {displayRecommendationToken(outcome.classifierVersion)} ·
                  revision {outcome.revision}
                </StatusPill>
                <StatusPill tone="muted">
                  watermark {outcome.factWatermark}
                </StatusPill>
                <StatusPill tone="muted">
                  lag {outcome.finalizationLagMilliseconds} ms
                </StatusPill>
              </div>
              <p className="mt-3 font-mono text-[11px] text-[var(--color-text-secondary)]">
                active {outcome.activePlaybackMilliseconds ?? "—"} ms · coverage{" "}
                {displayRecommendationToken(outcome.activeCoverage)} · cohort{" "}
                {displayRecommendationToken(outcome.durationCohort)} · quality{" "}
                {outcome.viewQualityWeight ?? "—"}
              </p>
              <p className="mt-2 break-all font-mono text-[10px] text-[var(--color-text-muted)]">
                digest {outcome.inputDigest} · supersedes{" "}
                {outcome.supersedesId ?? "none"}
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px] text-[var(--color-text-muted)]">
                {JSON.stringify(outcome.activeIntervals ?? [], null, 2)}
              </pre>
            </article>
          ))}
        </div>
      </PageSection>
    </div>
  )
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="label-text">{label}</div>
      <div className="mt-1 break-all font-mono text-[11px] text-[var(--color-text-secondary)]">
        {value}
      </div>
    </div>
  )
}
