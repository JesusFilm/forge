import type { Metadata } from "next"
import { DEFAULT_LOCALE } from "@/lib/locale"
import { getWatchExperience, experienceToMetadata } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

export const revalidate = 60

const SITE_BASE = "https://www.jesusfilm.org"

export async function generateMetadata(): Promise<Metadata> {
  const locale = DEFAULT_LOCALE
  const result = await getWatchExperience(locale)
  const cms = result.data ? experienceToMetadata(result.data) : null

  const title = cms?.title ?? "Watch | Jesus Film Project"
  const description =
    cms?.description ?? "Watch films and videos about the life of Jesus."

  return {
    title,
    description,
    openGraph: {
      title: cms?.ogTitle ?? title,
      description: cms?.ogDescription ?? description,
      url: `${SITE_BASE}/watch`,
      siteName: "Jesus Film Project",
      type: "website",
    },
    alternates: { canonical: `${SITE_BASE}/watch` },
  }
}

export default async function HomePage() {
  const locale = DEFAULT_LOCALE
  const result = await getWatchExperience(locale)

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

  return (
    <main className="min-h-screen bg-stone-900">
      {blocks.map((block, i) => {
        const key =
          "id" in block && typeof block.id === "string"
            ? block.id
            : `block-${i}`
        return <SectionRenderer key={key} section={block} />
      })}
    </main>
  )
}
