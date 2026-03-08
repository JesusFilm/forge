import type { Metadata } from "next"
import { getLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { getEasterMetadata } from "./metadata"

const EASTER_SLUG = "easter"

/** SEO and social metadata for /watch/easter (locale-aware). */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  return getEasterMetadata(locale) as Metadata
}

/** Easter-themed watch page at /watch/easter; content driven by CMS experience slug "easter". */
export default async function EasterWatchPage() {
  const locale = await getLocale()
  const result = await getWatchExperience(locale, { slug: EASTER_SLUG })

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
  if (sections.length === 0) {
    return <ExperienceEmpty />
  }

  return (
    <main className="min-h-screen">
      {sections.map((section, i) => (
        <SectionRenderer key={`section-${i}`} section={section} />
      ))}
    </main>
  )
}
