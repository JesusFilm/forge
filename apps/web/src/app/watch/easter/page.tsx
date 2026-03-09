import type { Metadata } from "next"
import { getLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"
import { getEasterMetadata } from "./metadata"

const EASTER_SLUG = "easter"

/** SEO and social metadata for /watch/easter (locale-aware, CMS-driven with fallback). */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  return (await getEasterMetadata(locale)) as Metadata
}

/** Easter-themed watch page at /watch/easter; content driven by CMS experience slug "easter". */
export default async function EasterWatchPage() {
  const locale = await getLocale()
  const result = await getWatchExperience(locale, EASTER_SLUG)

  if (result.error) {
    return <ExperienceError message={result.error.message} />
  }

  const experience = result.data
  if (!experience?.blocks?.length) {
    return <ExperienceEmpty />
  }

  const blocks = experience.blocks.filter(
    (b): b is Section => b !== null && b.__typename !== "Error",
  )
  if (blocks.length === 0) {
    return <ExperienceEmpty />
  }

  return (
    <main className="min-h-screen">
      {blocks.map((block, i) => (
        <ExperienceSectionRenderer key={`block-${i}`} section={block} />
      ))}
    </main>
  )
}
