import { FeedbackWizard } from "@/components/FeedbackWizard"
import { FeedbackGrantGate } from "@/components/FeedbackGrantGate"
import { readQrContext } from "@/lib/contracts"
import { grantMode } from "@/server/tvGrant"

export default async function AdvancedFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value)
  }
  return (
    <FeedbackGrantGate required={grantMode() === "enforce"}>
      <FeedbackWizard initialTvContext={readQrContext(query)} />
    </FeedbackGrantGate>
  )
}
