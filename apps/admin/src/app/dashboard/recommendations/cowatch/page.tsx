import Link from "next/link"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import {
  DashboardPageHeader,
  PageSection,
  StatusPill,
} from "@/components/admin-ui"
import { prisma } from "@/db/client"
import { env } from "@/config/env"
import { recommendationTraceActorDigest } from "@/services/recommendations/admin-ops/shared"
import {
  loadCowatchInspection,
  type CowatchInspection,
} from "@/services/recommendations/cowatch/inspection.service"

function bounded(value: string | string[] | undefined, max: number) {
  return typeof value === "string" && value.length <= max ? value.trim() : ""
}

export default async function CowatchInspectionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-aggregates")) {
    redirect("/dashboard")
  }
  const canReadTraces = hasPermission(principal, "read:recommendation-traces")
  const params = await searchParams
  const sourceMediaId = bounded(params.anchor, 191)
  const requestId = canReadTraces ? bounded(params.request, 191) : ""
  const inspection = await loadCowatchInspection(prisma, {
    now: new Date(),
    sourceMediaId,
    requestId,
    actorDigest:
      canReadTraces && principal.id
        ? recommendationTraceActorDigest(principal.id, env.ADMIN_SESSION_SECRET)
        : null,
  })
  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Recommendation operations / shadow"
        title="Directional co-watch"
        description="Population transitions, profile-selected anchors, and a terminal shadow decision. No co-watch edge changes the live Watch slate."
        action={
          <Link
            href="/dashboard/recommendations"
            className="text-[13px] text-[var(--color-text-secondary)] underline underline-offset-4"
          >
            Recommendations
          </Link>
        }
      />
      <PageSection
        title="Generation and decision"
        meta="SHADOW ONLY / NO PROMOTION"
      >
        <div className="space-y-3 p-4 text-[13px] text-[var(--color-text-secondary)]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              tone={inspection.state === "current" ? "success" : "warning"}
            >
              {inspection.state}
            </StatusPill>
            <StatusPill tone="warning">No promotion</StatusPill>
            <StatusPill tone="muted">
              {inspection.candidateDecision.replaceAll("_", " ")}
            </StatusPill>
          </div>
          <p>
            Reason: {inspection.decisionReason.replaceAll("_", " ")}. Controlled
            usefulness evaluation belongs to feat-505.
          </p>
          <p>
            Latest co-watch shadow evaluation:{" "}
            {inspection.shadowEvaluation
              ? `${inspection.shadowEvaluation.state}; ${inspection.shadowEvaluation.decision ?? "pending"} (${inspection.shadowEvaluation.reasonCode ?? "awaiting result"}); ${inspection.shadowEvaluation.processedCount}/${inspection.shadowEvaluation.sampledCount} processed; coverage ${inspection.shadowEvaluation.coverage?.toFixed(2) ?? "unavailable"}; overlap ${inspection.shadowEvaluation.overlap?.toFixed(2) ?? "unavailable"}; p95 latency ${inspection.shadowEvaluation.latencyP95Ms ?? "unavailable"} ms`
              : "not run"}
          </p>
          <p>
            Generation:{" "}
            <code className="break-all">
              {inspection.generation ?? "unavailable"}
            </code>
          </p>
          <p>
            Published: {inspection.publishedAt?.toISOString() ?? "unavailable"}
          </p>
          <p>
            Eligible outcomes {inspection.sourceCount} · exact contributions{" "}
            {inspection.contributionCount} · directional edges{" "}
            {inspection.edgeCount} · distinct support units{" "}
            {inspection.distinctViewerCount}
          </p>
          {inspection.staleReasons.length > 0 ? (
            <p>Fence: {inspection.staleReasons.join(", ")}</p>
          ) : null}
        </div>
      </PageSection>
      <PageSection title="Inspect an anchor" meta="READ ONLY">
        <form
          action="/dashboard/recommendations/cowatch"
          method="get"
          className="grid gap-3 p-4 md:grid-cols-3"
        >
          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Source media ID
            <input
              name="anchor"
              maxLength={191}
              defaultValue={sourceMediaId}
              className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent px-2 py-2 text-[13px]"
            />
          </label>
          {canReadTraces ? (
            <>
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Request ID for profile anchors and live overlap
                <input
                  name="request"
                  maxLength={191}
                  defaultValue={requestId}
                  className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent px-2 py-2 text-[13px]"
                />
              </label>
            </>
          ) : null}
          <button
            type="submit"
            className="w-fit border border-[var(--color-hairline)] px-3 py-2 text-[13px] md:col-span-3"
          >
            Inspect
          </button>
        </form>
      </PageSection>
      <PageSection
        title="Chosen anchors and candidate overlap"
        meta="PROFILE SELECTS / GRAPH REMAINS POPULATION WIDE"
      >
        <div className="space-y-2 p-4 text-[13px] text-[var(--color-text-secondary)]">
          <p>
            {inspection.anchors.length
              ? inspection.anchors
                  .map(
                    (anchor) =>
                      `${anchor.mediaId} (${anchor.kind}, weight ${anchor.weight.toFixed(2)})`,
                  )
                  .join(" · ")
              : "No anchors selected."}
          </p>
          <p>
            Candidate overlap with inspected live request:{" "}
            {inspection.overlapMediaIds.length
              ? inspection.overlapMediaIds.join(", ")
              : "none or request unavailable"}
          </p>
          <p>
            {inspection.candidates.length} supported shadow candidates. Sparse,
            stale, or incompatible evidence retains the observed live slate.
          </p>
        </div>
      </PageSection>
      <EdgeTable title="A → B evidence" edges={inspection.selectedEdges} />
      <EdgeTable title="B → A evidence" edges={inspection.reverseEdges} />
    </div>
  )
}

function EdgeTable({
  title,
  edges,
}: {
  title: string
  edges: CowatchInspection["selectedEdges"]
}) {
  return (
    <PageSection title={title} meta="DIRECTIONAL / POPULATION EVIDENCE">
      {edges.length === 0 ? (
        <p className="p-4 text-[13px] text-[var(--color-text-muted)]">
          No edge evidence in this generation for the selected anchor.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px] text-[var(--color-text-secondary)]">
            <thead>
              <tr className="border-b border-[var(--color-hairline)]">
                <th className="p-3">Direction</th>
                <th className="p-3">Viewers / sessions</th>
                <th className="p-3">Lift</th>
                <th className="p-3">Confidence</th>
                <th className="p-3">Recency / quality</th>
                <th className="p-3">Concentration</th>
                <th className="p-3">Gate</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((edge) => (
                <tr
                  key={`${edge.sourceMediaId}:${edge.targetMediaId}`}
                  className="border-b border-[var(--color-hairline)]"
                >
                  <td className="p-3">
                    {edge.sourceMediaId} → {edge.targetMediaId}
                  </td>
                  <td className="p-3">
                    {edge.distinctViewerSupport} / {edge.sessionSupport}
                  </td>
                  <td className="p-3">
                    {edge.popularityCorrectedLift.toFixed(2)}
                  </td>
                  <td className="p-3">{edge.confidence.toFixed(2)}</td>
                  <td className="p-3">
                    {edge.recencyWeight.toFixed(2)} /{" "}
                    {edge.qualityWeight.toFixed(2)}
                  </td>
                  <td className="p-3">{edge.contamination.toFixed(2)}</td>
                  <td className="p-3">
                    {edge.eligible ? "supported" : "suppressed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageSection>
  )
}
