import { getCmsGateway } from "@/cms/gateway"
import { createSwrCache } from "@/lib/swr-cache"

async function fetchLanguageGeo(): Promise<string> {
  const gateway = getCmsGateway()
  return JSON.stringify(await gateway.getLanguageGeo())
}

export const languageCache = createSwrCache({
  fetcher: fetchLanguageGeo,
  ttlMs: 24 * 60 * 60_000,
  maxStaleMs: 48 * 60 * 60_000,
  label: "language-cache",
})
