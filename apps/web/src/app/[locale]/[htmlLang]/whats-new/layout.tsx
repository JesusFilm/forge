import type { ReactNode } from "react"

import "@/components/whats-new/whats-new.css"

import { WatchChromeShell } from "@/components/WatchChromeShell"

export default async function WatchWhatsNewLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <WatchChromeShell locale={locale}>{children}</WatchChromeShell>
}
