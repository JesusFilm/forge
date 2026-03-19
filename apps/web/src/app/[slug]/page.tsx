import { Suspense } from "react"
import type { Metadata } from "next"
import { getLocale, isLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
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
  if (isLocale(slug)) return {}

  const title = `${slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} | Jesus Film Project`
  return {
    title,
    alternates: { canonical: `https://www.jesusfilm.org/watch/${slug}` },
  }
}

async function SlugContent({ slug }: { slug: string }) {
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

export default async function SlugPage({ params }: PageProps) {
  const { slug } = await params
  return (
    <Suspense>
      <SlugContent slug={slug} />
    </Suspense>
  )
}
