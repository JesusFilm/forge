import type { Metadata } from "next"
import { getLocale, isLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { getExperienceMetadata } from "@/lib/experience-metadata"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

type PageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params

  // If slug is a locale (e.g. /watch/en), let the homepage handle metadata.
  if (isLocale(slug)) return {}

  const locale = await getLocale()
  return getExperienceMetadata(locale, slug, { pathPrefix: "watch" })
}

export default async function SlugPage({ params }: PageProps) {
  const { slug } = await params
  const locale = await getLocale(isLocale(slug) ? slug : undefined)

  const result = isLocale(slug)
    ? await getWatchExperience(locale)
    : await getWatchExperience(locale, slug)

  if (result.error) {
    return <ExperienceError message={result.error.message} />
  }

  const experience = result.data
  const blocks = (experience?.blocks ?? []).filter(
    (b): b is Section => b !== null && b.__typename !== "Error",
  )
  if (!blocks.length) {
    return <ExperienceEmpty />
  }

  return (
    <main className="min-h-screen space-y-5 bg-stone-900">
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
