import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { PhotoFeedbackFlow } from "@/components/PhotoFeedbackFlow"
import { readQrContext } from "@/lib/contracts"
import { localFeedbackConfig } from "@/server/localConfig"

export const dynamic = "force-dynamic"

export default async function LocalFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let config: ReturnType<typeof localFeedbackConfig>
  try {
    config = localFeedbackConfig()
  } catch {
    notFound()
  }
  if ((await headers()).get("host") !== new URL(config.origin).host) notFound()
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value)
  }
  return (
    <PhotoFeedbackFlow
      tvContext={readQrContext(query)}
      advancedHref="/tv/local"
      localMode={{ linearEnabled: config.linearEnabled }}
    />
  )
}
