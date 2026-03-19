import { Suspense } from "react"
import type { Metadata } from "next"
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { getExperienceMetadata } from "@/lib/experience-metadata"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

type PageProps = {
  params: Promise<{ slug: string; locale: string }>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, locale: rawLocale } = await params
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  return getExperienceMetadata(locale, slug, {
    pathLocale: rawLocale,
    pathPrefix: "watch",
  })
}

async function SlugLocaleContent({
  slug,
  rawLocale,
}: {
  slug: string
  rawLocale: string
}) {
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const result = await getWatchExperience(locale, slug)

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

export default async function SlugLocalePage({ params }: PageProps) {
  const { slug, locale: rawLocale } = await params
  return (
    <Suspense>
      <SlugLocaleContent slug={slug} rawLocale={rawLocale} />
    </Suspense>
  )
}
