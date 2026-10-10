import type { ReactNode } from "react"

import { FeedbackLauncher } from "@/components/FeedbackLauncher"
import { FloatingSearchProvider } from "@/components/FloatingSearchProvider"
import type { WatchRouteSurface } from "@/components/FloatingSearchContext"
import { BetaTesterModalProvider } from "@/components/watch/BetaTesterModalProvider"
import {
  publicWatchHomeLanguageSlugForLocale,
  resolveWatchLocaleIdentity,
} from "@/lib/locale"

export function WatchChromeShell({
  children,
  locale,
  initialRouteSurface = null,
}: {
  children: ReactNode
  locale: string
  initialRouteSurface?: WatchRouteSurface | null
}) {
  const { locale: uiLocale } = resolveWatchLocaleIdentity(locale)
  const defaultLanguageSlug =
    publicWatchHomeLanguageSlugForLocale(uiLocale) ?? "english"

  return (
    <FloatingSearchProvider
      defaultLanguageSlug={defaultLanguageSlug}
      initialRouteSurface={initialRouteSurface}
    >
      <FeedbackLauncher />
      <BetaTesterModalProvider>{children}</BetaTesterModalProvider>
    </FloatingSearchProvider>
  )
}
