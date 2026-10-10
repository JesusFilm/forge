import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"

type PageProps = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "WatchNotFound" })
  return { title: t("metadataTitle") }
}

export default function WatchNotFoundSentinel() {
  notFound()
}
