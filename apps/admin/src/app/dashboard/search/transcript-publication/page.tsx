import type { Route } from "next"
import Link from "next/link"

import {
  DashboardPageHeader,
  MetricCard,
  PageSection,
  cx,
} from "@/components/admin-ui"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { loadWatchSearchTranscriptPublicationHealth } from "@/services/typesense-watch-search-transcript-publication"

function formatRevision(value: string | null | undefined) {
  return value ?? "Not yet published"
}

function formatAge(ms: number | null) {
  if (ms == null) return "None pending"
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "<1 min"
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTimestamp(value: Date | null | undefined) {
  if (!value) return "Never"
  return value.toISOString()
}

export default async function WatchSearchTranscriptPublicationPage() {
  await requireSession()
  const health = await loadWatchSearchTranscriptPublicationHealth(prisma)

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Operator evidence"
        title="Transcript publication health"
        description="Durable evidence that accepted canonical transcript replacements reached the active Watch Search transcript collection."
        action={
          <Link
            href={"/dashboard/search" as Route}
            className="rounded-sm border border-[var(--color-hairline)] px-3 py-2 font-mono text-[11px] uppercase text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
          >
            Back to search
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Projection revision"
          value={formatRevision(health.projection?.projectionRevision)}
          footer={
            health.projection?.transcriptCollection ?? "No projection yet"
          }
        />
        <MetricCard
          label="Pending / claimed"
          value={`${health.pendingCount} / ${health.claimedCount}`}
          footer="Outbox events awaiting or in publication"
        />
        <MetricCard
          label="Oldest pending age"
          value={formatAge(health.oldestPendingAgeMs)}
          footer={
            health.stale
              ? "Exceeds the 15 minute freshness alert threshold"
              : "Within the freshness objective"
          }
          accent={health.stale ? "danger" : undefined}
        />
        <MetricCard
          label="Dead-lettered"
          value={String(health.deadLetterCount)}
          footer="Bounded failures needing operator repair"
          accent={health.deadLetterCount > 0 ? "danger" : undefined}
        />
      </div>

      <PageSection
        title="Dead-lettered transcripts"
        meta={`${health.recentDeadLetters.length} most recent`}
      >
        {health.recentDeadLetters.length === 0 ? (
          <div className="px-4 py-6 text-[13px] text-[var(--color-text-muted)]">
            No dead-lettered transcript publication work.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="hairline-strong-b text-left font-mono text-[11px] uppercase text-[var(--color-text-muted)]">
                <th className="px-4 py-2">Transcript</th>
                <th className="px-4 py-2">Video</th>
                <th className="px-4 py-2">Language</th>
                <th className="px-4 py-2">Kind</th>
                <th className="px-4 py-2">Attempts</th>
                <th className="px-4 py-2">Last error</th>
                <th className="px-4 py-2">Dead-lettered at</th>
              </tr>
            </thead>
            <tbody>
              {health.recentDeadLetters.map((row) => (
                <tr
                  key={row.transcriptId}
                  className={cx(
                    "hairline-strong-b font-mono text-[12px]",
                    "text-[var(--color-text-secondary)]",
                  )}
                >
                  <td className="px-4 py-2">{row.transcriptId}</td>
                  <td className="px-4 py-2">{row.videoId}</td>
                  <td className="px-4 py-2">{row.language}</td>
                  <td className="px-4 py-2">{row.workKind}</td>
                  <td className="px-4 py-2">{row.attemptCount}</td>
                  <td className="px-4 py-2">
                    {row.lastErrorCode ?? "Unknown"}
                  </td>
                  <td className="px-4 py-2">
                    {formatTimestamp(row.deadLetteredAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageSection>
    </div>
  )
}
