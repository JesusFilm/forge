import type { Metadata } from "next"
import { setRequestLocale } from "next-intl/server"
import { resolveWatchLocaleIdentity } from "@/lib/locale"
import { resolveWatchHome } from "@/lib/watch-home"
import { getWatchPageMetadata } from "@/lib/experience-metadata"
import { WatchHomePage } from "@/components/home/WatchHomePage"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

export const revalidate = 60
export const dynamic = "force-static"
export const dynamicParams = true

export function generateStaticParams(): Array<{
  locale: string
  htmlLang: string
}> {
  return []
}

type PageProps = {
  params: Promise<{ locale: string; htmlLang: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  return getWatchPageMetadata(locale)
}

export default async function HomePage({ params }: PageProps) {
  const { locale: rawLocale } = await params
  const { locale } = resolveWatchLocaleIdentity(rawLocale)
  setRequestLocale(locale)
  const result = await resolveWatchHome(locale)

  if (result.error) {
    return <ExperienceError message={result.error.message} />
  }

  if (!result.data.heroSlides.length && !result.data.sections.length) {
    return <ExperienceEmpty />
  }

  return <WatchHomePage model={result.data} />
}
