import Image from "next/image"
import { ExperienceSectionRenderer, type Section } from "@/components/sections"
import { WatchHomeFooter } from "@/components/home/WatchHomeFooter"
import { WatchHomePromo } from "@/components/home/WatchHomePromo"
import { WatchHomeSection } from "@/components/home/WatchHomeSection"
import { WatchHomeTvCarousel } from "@/components/home/WatchHomeTvCarousel"
import type { WatchHomeModel } from "@/lib/watch-home"

type WatchHomeExperiencePageProps = {
  heroModel: WatchHomeModel
  blocks: readonly Section[]
}

function findBackdropImage(model: WatchHomeModel): {
  url: string
  alt: string
} | null {
  const card =
    model.heroSlides.find((slide) => slide.imageUrl) ??
    model.sections
      .flatMap((section) => section.cards)
      .find((sectionCard) => sectionCard.imageUrl)

  return card?.imageUrl ? { url: card.imageUrl, alt: card.imageAlt } : null
}

function isWatchHomeHeroBlock(block: Section) {
  return (
    (block as { readonly __typename?: string | null }).__typename ===
    "WatchHomeHeroBlock"
  )
}

export function WatchHomeExperiencePage({
  heroModel,
  blocks,
}: WatchHomeExperiencePageProps) {
  const backdrop = findBackdropImage(heroModel)
  const hasHeroBlock = blocks.some(isWatchHomeHeroBlock)
  const fallbackSections = blocks.length === 0 ? heroModel.sections : []

  return (
    <main className="min-h-screen overflow-x-hidden bg-black text-white">
      <div
        className="relative font-sans text-white"
        style={{ minHeight: "100svh" }}
      >
        <div className="sticky top-0 z-[1] mx-auto h-screen max-w-[1920px] overflow-hidden bg-black/10">
          {backdrop ? (
            <Image
              src={backdrop.url}
              alt={backdrop.alt}
              fill
              priority
              sizes="100vw"
              className="scale-110 object-cover opacity-45 blur-sm"
            />
          ) : (
            <div
              aria-hidden
              className="h-full w-full bg-[linear-gradient(135deg,#020617,#3f1d2b_50%,#14332c)]"
            />
          )}
          <div
            aria-hidden
            className="absolute inset-0 bg-black/10"
            style={{ backdropFilter: "brightness(.6) blur(40px)" }}
          />
          <div aria-hidden className="absolute inset-0 bg-black/35" />
        </div>

        <div className="relative z-10 mx-auto -mt-[100vh] max-w-[1920px] overflow-x-clip">
          {hasHeroBlock ? null : (
            <WatchHomeTvCarousel
              slides={heroModel.heroSlides}
              sequence={heroModel.carousel}
            />
          )}
          {blocks.map((block, index) =>
            isWatchHomeHeroBlock(block) ? (
              <WatchHomeTvCarousel
                key={
                  (block as { sectionKey?: string | null }).sectionKey ?? index
                }
                slides={heroModel.heroSlides}
                sequence={heroModel.carousel}
              />
            ) : (
              <ExperienceSectionRenderer
                key={
                  (block as { sectionKey?: string | null }).sectionKey ?? index
                }
                section={block}
              />
            ),
          )}
          {fallbackSections.map((section) => (
            <WatchHomeSection key={section.id} section={section} />
          ))}
          <WatchHomePromo />
          <WatchHomeFooter />
        </div>
      </div>
    </main>
  )
}
