import { getLocale, isLocale } from "@/lib/locale"
import { getWatchExperience } from "@/lib/content"
import { SectionRenderer, type Section } from "@/components/sections"
import { ExperienceEmpty } from "@/components/ExperienceEmpty"
import { ExperienceError } from "@/components/ExperienceError"

type PageProps = {
  params: Promise<{ param: string }>
}

export default async function ParamPage({ params }: PageProps) {
  const { param } = await params
  const locale = await getLocale(isLocale(param) ? param : undefined)

  const result = isLocale(param)
    ? await getWatchExperience(locale)
    : await getWatchExperience(locale, { slug: param })

  if (result.error) {
    return <ExperienceError message={result.error.message} />
  }

  const experience = result.data
  if (!experience?.sections?.length) {
    return <ExperienceEmpty />
  }

  return (
    <main className="min-h-screen">
      {(
        experience.sections as Array<Section | { __typename: "Error" } | null>
      ).map((section, i) => {
        if (
          !section ||
          ("__typename" in section && section.__typename === "Error")
        )
          return null
        const key = "id" in section ? section.id : `section-${i}`
        return <SectionRenderer key={key} section={section as Section} />
      })}
    </main>
  )
}
