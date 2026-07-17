import { ShortsCreateScreen } from "@/features/shorts/shorts-create-screen"

export const dynamic = "force-dynamic"

function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function firstNumber(value: string | string[] | undefined): number | undefined {
  const raw = firstString(value)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export default async function NewShortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  // Clone flow prefill (plan decision 3): /dashboard/shorts/new?coreId=&start=&end=
  const prefill = {
    coreId: firstString(params.coreId),
    startSec: firstNumber(params.start),
    endSec: firstNumber(params.end),
  }

  return (
    <div className="studio-page studio-page--shorts-new">
      <ShortsCreateScreen prefill={prefill} />
    </div>
  )
}
