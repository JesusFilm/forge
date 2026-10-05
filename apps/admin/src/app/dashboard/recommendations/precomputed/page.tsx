import Link from "next/link"
import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { DashboardPageHeader, PageSection } from "@/components/admin-ui"
import { prisma } from "@/db/client"
import {
  loadPrecomputedRecommendationComparison,
  loadPrecomputedReviewSelection,
} from "@/services/recommendations/precomputed/contract"
import { PrecomputedComparisonView } from "./view"

function bounded(value: string | string[] | undefined, max: number): string {
  return typeof value === "string" && value.length <= max ? value.trim() : ""
}

export default async function PrecomputedRecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const principal = await requireSession()
  if (
    !hasPermission(principal, "read:recommendation-aggregates") ||
    !hasPermission(principal, "read:recommendation-traces")
  )
    redirect("/dashboard")

  const params = await searchParams
  const sourceQuery = bounded(params.source, 191)
  const requestedGenerationId = bounded(params.generation, 191)
  const audioLanguageSlug = bounded(params.audio, 80) || "english"
  const { generations, source, generationId } =
    await loadPrecomputedReviewSelection(prisma, {
      sourceQuery,
      generationId: requestedGenerationId,
      reviewer: principal,
    })
  const comparison =
    generationId && source
      ? await loadPrecomputedRecommendationComparison(prisma, {
          generationId,
          sourceVideoId: source.id,
          audioLanguageSlug,
          reviewer: principal,
        })
      : null

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        eyebrow="Recommendation operations / private experiment"
        title="Saved Video connections"
        description="Inspect a complete saved generation beside the anonymous contextual incumbent and the current semantic retrieval input. Measured Watch visits may compose different slates. This page does not create a Watch visit or change public serving."
        action={
          <Link
            href="/dashboard/recommendations"
            className="text-[13px] underline underline-offset-4"
          >
            Recommendations
          </Link>
        }
      />
      <PageSection title="Choose a source and generation" meta="READ ONLY">
        <form
          action="/dashboard/recommendations/precomputed"
          method="get"
          className="grid gap-3 p-4 md:grid-cols-3"
        >
          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Source Video ID or slug
            <input
              name="source"
              required
              maxLength={191}
              defaultValue={sourceQuery}
              className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent px-2 py-2 text-[13px]"
            />
          </label>
          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Generation ID (blank selects latest)
            <input
              name="generation"
              maxLength={191}
              defaultValue={requestedGenerationId}
              list="saved-generations"
              className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent px-2 py-2 text-[13px]"
            />
            <datalist id="saved-generations">
              {generations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.status} · {item.modelId}
                </option>
              ))}
            </datalist>
          </label>
          <label className="text-[12px] text-[var(--color-text-secondary)]">
            Selected audio language slug
            <input
              name="audio"
              required
              maxLength={80}
              defaultValue={audioLanguageSlug}
              className="mt-1 w-full border border-[var(--color-hairline)] bg-transparent px-2 py-2 text-[13px]"
            />
          </label>
          <button
            type="submit"
            className="w-fit border border-[var(--color-hairline)] px-3 py-2 text-[13px] md:col-span-3"
          >
            Compare
          </button>
        </form>
      </PageSection>
      {!sourceQuery ? (
        <PageSection title="Awaiting source Video" meta="PRIVATE">
          <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
            Select a source Video to inspect its saved connections.
          </p>
        </PageSection>
      ) : !source ? (
        <PageSection title="Source Video not found" meta="PRIVATE">
          <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
            No Video matches that ID or slug.
          </p>
        </PageSection>
      ) : !generationId ? (
        <PageSection title="No saved generation" meta="PRIVATE">
          <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
            No private recommendation generation has been submitted yet.
          </p>
        </PageSection>
      ) : comparison ? (
        <PrecomputedComparisonView comparison={comparison} />
      ) : null}
    </div>
  )
}
