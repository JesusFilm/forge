import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import type { RouteVideo } from "@/lib/content"
import type { WatchHomeCarouselData } from "@/lib/watch-home-carousel"
import { WatchHomeCarouselClient } from "./WatchHomeCarouselClient"
import { filterWatchHomeBelowFoldBlocks } from "./watch-home-blocks"

type WatchHomePageProps = {
  carousel: WatchHomeCarouselData
  blocks: Section[]
  routeVideo?: RouteVideo | null
}

export function WatchHomePage({
  blocks,
  carousel,
  routeVideo = null,
}: WatchHomePageProps) {
  const belowFoldBlocks = filterWatchHomeBelowFoldBlocks(blocks)

  return (
    <main className="min-h-screen bg-black">
      <WatchHomeCarouselClient data={carousel} />
      {belowFoldBlocks.length ? (
        <div className="bg-stone-900">
          {belowFoldBlocks.map((block, i) => {
            const key =
              "id" in block && typeof block.id === "string"
                ? block.id
                : `block-${i}`
            return (
              <ExperienceSectionRenderer
                key={key}
                section={block}
                routeVideo={routeVideo}
              />
            )
          })}
        </div>
      ) : null}
    </main>
  )
}
