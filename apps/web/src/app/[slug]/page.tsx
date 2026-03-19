import { cacheLife, cacheTag } from "next/cache"
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

type PageProps = {
  params: Promise<{ slug: string }>
}

export default async function SlugPage({ params }: PageProps) {
  "use cache"

  const { slug } = await params
  const locale = isLocale(slug) ? slug : DEFAULT_LOCALE
  const tagSlug = isLocale(slug) ? "homepage" : slug

  cacheTag(
    "experience",
    `experience:${tagSlug}`,
    `experience:${tagSlug}:${locale}`,
  )
  cacheLife("max")

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
