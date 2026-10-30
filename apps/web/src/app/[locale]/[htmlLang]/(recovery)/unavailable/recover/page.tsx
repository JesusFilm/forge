import { setRequestLocale } from "next-intl/server"

import { WatchUnavailableLanguage } from "@/components/watch/WatchUnavailableLanguage"

export { generateMetadata } from "../../../unavailable/404/page"

export const dynamic = "force-dynamic"

export default async function WatchUnavailableRecovery({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  return <WatchUnavailableLanguage />
}
