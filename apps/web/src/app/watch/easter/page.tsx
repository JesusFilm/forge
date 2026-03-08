import type { Metadata } from "next"
import { getLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

const EASTER_SLUG = "easter"

/** SEO metadata for the Easter watch page (title, description, canonical). */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Easter | Watch",
    description:
      "Watch curated Easter content. Discover films and resources for the Easter season.",
    alternates: {
      canonical: "/watch/easter",
    },
  }
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

  return (
    <main className="min-h-screen">
      {sections.map((section, i) => {
        const key = section.id ?? `section-${i}`
        return <SectionRenderer key={key} section={section} />
      })}
    </main>
  )
}
