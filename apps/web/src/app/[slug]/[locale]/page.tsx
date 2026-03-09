import { isLocale, DEFAULT_LOCALE } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
}

export default async function SlugLocalePage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const result = await getWatchExperience(locale, slug)

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
    <main className="min-h-screen">
      {blocks.map((block, i) => {
        return <SectionRenderer key={`block-${i}`} section={block} />
      })}
    </main>
  )
}
