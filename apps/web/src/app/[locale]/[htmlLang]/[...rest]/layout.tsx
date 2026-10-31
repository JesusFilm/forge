import type { ReactNode } from "react"

import { WatchChromeShell } from "@/components/WatchChromeShell"
import { initialWatchRouteSurface } from "./initial-watch-route-surface"

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
