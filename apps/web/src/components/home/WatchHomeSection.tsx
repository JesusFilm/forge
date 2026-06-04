import { WatchHomeCard } from "@/components/home/WatchHomeCard"
import { cn } from "@/lib/utils"
import type { WatchHomeSection as WatchHomeSectionModel } from "@/lib/watch-home"

type WatchHomeSectionProps = {
  section: WatchHomeSectionModel
}

export function WatchHomeSection({ section }: WatchHomeSectionProps) {
  const isRail = section.layout === "rail"
  const isVertical = section.orientation === "vertical"

  return (
    <section
      data-testid="watch-home-section"
      data-section-id={section.id}
      className="py-10 text-white sm:py-14"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 max-w-3xl space-y-2">
          <p className="text-xs font-semibold tracking-[0.22em] text-red-200 uppercase">
            {section.eyebrow}
          </p>
          <h2 className="text-2xl leading-tight font-semibold tracking-normal sm:text-3xl">
            {section.title}
          </h2>
          {section.description ? (
            <p className="text-sm leading-6 text-stone-300 sm:text-base">
              {section.description}
            </p>
          ) : null}
        </div>

        <div
          className={cn(
            isRail
              ? "flex snap-x gap-4 overflow-x-auto pb-5 [scrollbar-width:thin]"
              : "grid gap-4",
            !isRail && isVertical
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
              : null,
            !isRail && !isVertical
              ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : null,
          )}
        >
          {section.cards.map((card, index) => (
            <WatchHomeCard
              key={`${section.id}-${card.id}-${index}`}
              card={card}
              index={index}
              orientation={section.orientation}
              showSequenceNumber={section.showSequenceNumbers}
              className={cn(
                isRail
                  ? isVertical
                    ? "w-[44vw] min-w-[160px] snap-start sm:w-[220px]"
                    : "w-[78vw] min-w-[260px] snap-start sm:w-[320px]"
                  : null,
              )}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
