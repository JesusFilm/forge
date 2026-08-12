import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { env } from "@/config/env"
import { createSeoAdminClient } from "@/features/seo/seo-admin-client"
import { SeoRunDetailView } from "@/features/seo/seo-run-detail"
import { requireAuth } from "@/lib/require-auth"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "SEO run audit — Studio",
}

function safeReturnHref(value?: string): string {
  if (!value) return "/dashboard/seo?view=runs"
  try {
    const url = new URL(value, "https://manager.invalid")
    if (
      url.origin === "https://manager.invalid" &&
      url.pathname === "/dashboard/seo" &&
      url.searchParams.get("view") === "runs"
    ) {
      return `${url.pathname}?${url.searchParams.toString()}`
    }
  } catch {
    return "/dashboard/seo?view=runs"
  }
  return "/dashboard/seo?view=runs"
}

export default async function SeoRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>
  searchParams?: Promise<{ returnTo?: string }>
}) {
  await requireAuth()
  const { runId } = await params
  const query = await searchParams

  if (env.MANAGER_DATA_MODE === "mock") {
    notFound()
  }

  const run = await (await createSeoAdminClient()).getSeoRun(runId)
  if (run == null) notFound()

  return (
    <div className="studio-page studio-page--seo">
      <SeoRunDetailView
        run={run}
        returnHref={safeReturnHref(query?.returnTo)}
      />
    </div>
  )
}
