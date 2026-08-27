import { WatchHomeCategoryRail } from "@/components/home/WatchHomeCategoryRail"
import type { WatchHomeRailTileInput } from "@/lib/watch-home-tiles"

export type WatchHomeCategoryRailExperienceData = {
  readonly categoryIds?: readonly string[] | null
  /**
   * Null on blocks stored before tile authoring shipped, and on any response
   * from an admin deploy that predates the field. Either way the renderer
   * falls back to `categoryIds`.
   */
  readonly tiles?: readonly WatchHomeRailTileInput[] | null
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
      tiles={data.tiles ?? null}
      languageSlug={languageSlug}
    />
  )
}
