import { redirect } from "next/navigation"
import { hasPermission } from "@/auth/permissions"
import { requireSession } from "@/auth/session"
import { prisma } from "@/db/client"
import { loadPrecomputedStorageCapacityReport } from "@/services/recommendations/precomputed/storage-capacity"
import { PrecomputedStorageView } from "./view"

export default async function PrecomputedStoragePage({
  searchParams,
}: {
  searchParams: Promise<{ generation?: string }>
}) {
  const principal = await requireSession()
  if (
    !hasPermission(principal, "read:recommendation-aggregates") ||
    !hasPermission(principal, "read:recommendation-traces")
  )
    redirect("/dashboard")
  const requestedId = (await searchParams).generation
  const generationId =
    typeof requestedId === "string" && requestedId.length <= 191
      ? requestedId.trim()
      : undefined
  const report = await loadPrecomputedStorageCapacityReport(prisma, {
    generationId,
  })
  return <PrecomputedStorageView report={report} generationId={generationId} />
}
