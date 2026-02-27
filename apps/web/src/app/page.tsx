import type { Metadata } from "next"
import { getLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

const SITE_NAME = "Jesus Film Project"

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const result = await getWatchExperience(locale)
  const experience = result.data
  const title = experience?.title ?? SITE_NAME
  const description = experience?.metaDescription ?? undefined
  return {
    title,
    ...(description && { description }),
  }
}

export default async function HomePage() {
  const locale = await getLocale()
  const result = await getWatchExperience(locale)

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
