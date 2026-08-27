import { WatchHomeCategoryRail } from "@/components/home/WatchHomeCategoryRail"

export type WatchHomeCategoryRailExperienceData = {
  readonly categoryIds?: readonly string[] | null
}

type WatchHomeCategoryRailExperienceProps = {
  data: WatchHomeCategoryRailExperienceData
  languageSlug: string
}

export function WatchHomeCategoryRailExperience({
  data,
  languageSlug,
}: WatchHomeCategoryRailExperienceProps) {
  return (
    <WatchHomeCategoryRail
      categoryIds={data.categoryIds ?? []}
      languageSlug={languageSlug}
    />
  )
}
