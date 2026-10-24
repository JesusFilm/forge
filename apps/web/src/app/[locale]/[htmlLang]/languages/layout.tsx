import type { ReactNode } from "react"

import { WatchChromeShell } from "@/components/WatchChromeShell"

export default async function WatchLanguagesLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <WatchChromeShell locale={locale}>{children}</WatchChromeShell>
}
