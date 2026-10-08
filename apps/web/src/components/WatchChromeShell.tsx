"use client"

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
  loadingOnly = false,
}: {
  children: ReactNode
  locale: string
  initialRouteSurface?: WatchRouteSurface | null
  loadingOnly?: boolean
}) {
  if (loadingOnly) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-50 h-20 border-b border-white/5 bg-black/60 backdrop-blur-md"
        >
          <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-6 px-6 md:px-12">
            <div className="h-8 w-28 animate-pulse rounded bg-stone-800" />
            <div className="hidden h-10 max-w-xl flex-1 animate-pulse rounded-full bg-stone-800 md:block" />
            <div className="size-10 animate-pulse rounded-full bg-stone-800" />
          </div>
        </div>
        {children}
      </div>
    )
  }

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
