import type { ReactNode } from "react"

import type { WatchRouteSurface } from "@/components/FloatingSearchContext"
import { WatchChromeShell } from "@/components/WatchChromeShell"
import { isPublicWatchHomeLanguageSlug } from "@/lib/locale"
import { stripHtmlSuffix } from "@/lib/url-shape"

export function initialWatchRouteSurface(
  rest: readonly string[],
): WatchRouteSurface | null {
  if (rest.length === 1) {
    const slug = stripHtmlSuffix(rest[0] ?? "")
    return isPublicWatchHomeLanguageSlug(slug) ? "language-home" : "experience"
  }
  if (rest.length === 2 && stripHtmlSuffix(rest[1] ?? "") === "english") {
    return "english-video"
  }
  return null
}

export default async function WatchContentLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string; rest: string[] }>
}) {
  const { locale, rest } = await params
  return (
    <WatchChromeShell
      locale={locale}
      initialRouteSurface={initialWatchRouteSurface(rest)}
    >
      {children}
    </WatchChromeShell>
  )
}
