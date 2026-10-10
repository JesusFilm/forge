import type { Metadata } from "next"
import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"

import { WatchChromeShell } from "@/components/WatchChromeShell"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "WatchNotFound" })
  return {
    title: t("metadataTitle"),
    robots: { index: false, follow: false },
  }
}

export default async function WatchNotFoundLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <WatchChromeShell locale={locale}>{children}</WatchChromeShell>
}
