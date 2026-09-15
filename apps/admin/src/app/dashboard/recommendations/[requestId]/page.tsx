import type { Route } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { firstSearchParam } from "@/app/dashboard/video-library-utils"
import { env } from "@/config/env"
import { prisma } from "@/db/client"
import {
  RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS,
  loadRecommendationRequestDetail,
  recommendationTraceActorDigest,
} from "@/services/recommendations/admin-ops"
import { RecommendationRequestDetailPanel } from "../request-detail-panel"

type RecommendationRequestPageProps = {
  params: Promise<{ requestId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function RecommendationRequestPage({
  params,
  searchParams,
}: RecommendationRequestPageProps) {
  const principal = await requireSession()
  if (!hasPermission(principal, "read:recommendation-traces")) {
    redirect("/dashboard/recommendations")
  }
  if (!principal.id) redirect("/dashboard/recommendations")
  const { requestId } = await params
  const query = (await searchParams) ?? {}
  const window = firstSearchParam(query.window)
  const detail = await loadRecommendationRequestDetail(prisma, {
    requestId,
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
        <div className="label-text">Privacy-safe request trace</div>
        <h1 className="mt-1 break-all text-2xl font-semibold">{detail.id}</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          {`Access is recorded in the sanitized ${RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS}-day operator audit.`}
        </p>
      </header>
      <RecommendationRequestDetailPanel detail={detail} />
    </div>
  )
}
