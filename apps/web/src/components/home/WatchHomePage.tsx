import { WatchHomeHero } from "@/components/home/WatchHomeHero"
import { WatchHomePromo } from "@/components/home/WatchHomePromo"
import { WatchHomeSection } from "@/components/home/WatchHomeSection"
import type { WatchHomeModel } from "@/lib/watch-home"

type WatchHomePageProps = {
  model: WatchHomeModel
}

export function WatchHomePage({ model }: WatchHomePageProps) {
  return (
    <main className="min-h-screen bg-black">
      <WatchHomeHero slides={model.heroSlides} />
      <div className="bg-black pb-8">
        {model.sections.map((section) => (
          <WatchHomeSection key={section.id} section={section} />
        ))}
      </div>
      <WatchHomePromo />
    </main>
  )
}
