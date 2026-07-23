import type { ServerRuntime } from "next"
import { NextResponse } from "next/server"

import { getSearchLanguageCatalogOptions } from "@/lib/search-language-actions"
import { projectGlobalLanguageOptions } from "@/lib/watch-language-switcher"

export const runtime: ServerRuntime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
} as const

export async function GET(): Promise<NextResponse> {
  try {
    const searchOptions = await getSearchLanguageCatalogOptions()
    const options = projectGlobalLanguageOptions(searchOptions)
    return NextResponse.json({ options }, { headers: NO_STORE_HEADERS })
  } catch {
    console.error("[watch] event=global_language_options.fetch.failed")
    return NextResponse.json(
      { error: "Language options are temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    )
  }
}
