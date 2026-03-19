import { Suspense } from "react"
import { cacheLife, cacheTag } from "next/cache"
import { DEFAULT_LOCALE } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

async function CachedHomeContent() {
  "use cache"

  cacheTag(
    "experience",
    "experience:homepage",
    `experience:homepage:${DEFAULT_LOCALE}`,
  )
  cacheLife("max")

  const result = await getWatchExperience(DEFAULT_LOCALE)

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
        const key =
          "id" in block && typeof block.id === "string"
            ? block.id
            : `block-${i}`
        return <SectionRenderer key={key} section={block} />
      })}
    </main>
  )
}

export default function HomePage() {
  return (
    <Suspense>
      <CachedHomeContent />
    </Suspense>
  )
}
