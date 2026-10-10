import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations, setRequestLocale } from "next-intl/server"

type PageProps = {
  params: Promise<{ locale: string }>
}

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({
    locale,
    namespace: "WatchUnavailableLanguage",
  })
  return {
    title: t("metadataTitle"),
    robots: { index: false, follow: false },
  }
}

export default async function WatchUnavailableSentinel({ params }: PageProps) {
  const { locale } = await params
  setRequestLocale(locale)
  notFound()
}
