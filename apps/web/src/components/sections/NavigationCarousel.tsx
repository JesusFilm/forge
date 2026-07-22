"use client"

import Image from "next/image"
import { useTranslations } from "next-intl"
import type {
  FragmentOf,
  LegacyFragmentValue,
} from "@/lib/legacy-fragment-types"
import { navigationCarouselFragment } from "@/lib/fragments/navigation-carousel"
import { CarouselItem } from "@/components/ui/carousel"
import {
  WatchCarousel,
  WatchCarouselContent,
} from "@/components/watch/WatchCarouselContent"
import { Card } from "@/components/ui/card"

export { navigationCarouselFragment }

type NavigationCarouselProps = {
  data: FragmentOf<typeof navigationCarouselFragment>
}

type NavItem = NonNullable<
  NonNullable<FragmentOf<typeof navigationCarouselFragment>["items"]>[number]
>

function handleNavigationClick(contentId: string) {
  const element = document.querySelector(
    `[data-section-key="${CSS.escape(contentId)}"]`,
  )
  element?.scrollIntoView({ behavior: "smooth", block: "start" })
}

function NavCard({ item, index }: { item: NavItem; index: number }) {
  const t = useTranslations("WatchHome")
  const isFirst = index === 0

  return (
    <Card
      className="beveled flex h-[240px] w-[200px] cursor-pointer flex-col justify-end gap-0 overflow-hidden rounded-lg border-0 py-0 ring-0 *:[img:first-child]:rounded-t-none focus-visible:outline-2 focus-visible:outline-white/70"
      style={{ backgroundColor: item.backgroundColor ?? "#1A1815" }}
      onClick={() => handleNavigationClick(item.contentId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          handleNavigationClick(item.contentId)
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={t("scrollToVideo", { title: item.title })}
      data-testid={`CarouselItem-${item.contentId.split("/")[0]}`}
    >
      {isFirst && item.imageUrl ? (
        <Image
          fill
          sizes="200px"
          src={item.imageUrl}
          alt={item.title}
          className="absolute top-0 h-[150px] w-full object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)] mask-cover"
          data-testid="CarouselItemImage"
        />
      ) : item.imageUrl ? (
        <Image
          fill
          sizes="200px"
          src={item.imageUrl}
          alt={item.title}
          className="absolute top-0 h-[150px] w-full object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)] mask-cover"
          data-testid="CarouselItemImg"
        />
      ) : null}
      <div className="p-4">
        <span
          className="text-xs font-medium tracking-wider uppercase text-amber-100/60"
          data-testid="CarouselItemCategory"
        >
          {item.category}
        </span>
        <h3
          className="line-clamp-3 text-base leading-tight font-bold text-white/90"
          data-testid={`CarouselItemTitle-${item.contentId.split("/")[0]}`}
        >
          {item.title}
        </h3>
      </div>
    </Card>
  )
}

export function NavigationCarousel({ data }: NavigationCarouselProps) {
  const items = data.items?.filter(
    (item: LegacyFragmentValue): item is NonNullable<typeof item> =>
      item != null,
  )
  if (!items?.length) return null

  return (
    <div className="w-full" data-testid="NavigationCarousel">
      <WatchCarousel
        opts={{
          dragFree: true,
          containScroll: "trimSnaps",
          align: "start",
        }}
        data-testid="NavigationCarouselSwiper"
      >
        <WatchCarouselContent className="-ml-5">
          {items.map((item: LegacyFragmentValue, index: number) => (
            <CarouselItem
              key={item.contentId}
              className="basis-auto pl-5"
              data-testid={`CarouselSlide-${item.contentId.split("/")[0]}`}
            >
              <NavCard item={item} index={index} />
            </CarouselItem>
          ))}
        </WatchCarouselContent>
      </WatchCarousel>
    </div>
  )
}
