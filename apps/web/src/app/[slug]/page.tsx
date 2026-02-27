import type { Metadata } from "next"
import { getLocale, isLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

const SITE_NAME = "Jesus Film Project"

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params
  const locale = await getLocale(isLocale(slug) ? slug : undefined)
  const result = isLocale(slug)
    ? await getWatchExperience(locale)
    : await getWatchExperience(locale, { slug })
  const experience = result.data
  const title =
    experience?.title ??
    (slug && !isLocale(slug) ? `${slug} | ${SITE_NAME}` : SITE_NAME)
  const description = experience?.metaDescription ?? undefined
  return {
    title,
    ...(description && { description }),
  }
}

export default async function SlugPage({ params }: PageProps) {
  const { slug } = await params
  const locale = await getLocale(isLocale(slug) ? slug : undefined)

  const result = isLocale(slug)
    ? await getWatchExperience(locale)
    : await getWatchExperience(locale, { slug })

  if (result.error) {
    return <ExperienceError message={result.error.message} />
  }

  const experience = result.data
  if (!experience?.sections?.length) {
    return <ExperienceEmpty />
  }

  const sections = experience.sections.filter(
    (s): s is Section => s !== null && s.__typename !== "Error",
  )

  return (
    <main className="min-h-screen">
      {sections.map((section, i) => {
        const key = section.id ?? `section-${i}`
        return <SectionRenderer key={key} section={section} />
      })}
    </main>
  )
}
