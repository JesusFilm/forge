"use client"

import Image from "next/image"
import type { FragmentOf } from "@forge/graphql"
import { navigationCarouselFragment } from "@/lib/fragments/navigation-carousel"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
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
  const isFirst = index === 0

  return (
    <Card
      className="beveled flex h-[240px] w-full cursor-pointer flex-col justify-end gap-0 rounded-lg border-0 py-0 ring-0 focus-visible:outline-2 focus-visible:outline-white/70"
      style={{ backgroundColor: item.backgroundColor ?? "#1A1815" }}
      onClick={() => handleNavigationClick(item.contentId)}
      onKeyDown={(e) =>
        e.key === "Enter" && handleNavigationClick(item.contentId)
      }
      tabIndex={0}
      role="button"
      aria-label={`Navigate to ${item.title}`}
      data-testid={`CarouselItem-${item.contentId.split("/")[0]}`}
    >
      {isFirst ? (
        <Image
          fill
          src={item.imageUrl ?? ""}
          alt={item.title}
          className="absolute top-0 h-[150px] w-full object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)] mask-cover"
          data-testid="CarouselItemImage"
        />
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={item.imageUrl ?? ""}
          alt={item.title}
          className="absolute top-0 h-[150px] w-full object-cover mask-[linear-gradient(to_bottom,rgba(0,0,0,1)_50%,transparent_100%)] mask-cover"
          data-testid="CarouselItemImg"
        />
      )}
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
    (item): item is NonNullable<typeof item> => item != null,
  )
  if (!items?.length) return null

  return (
    <div className="py-7" data-testid="NavigationCarousel">
      <div className="pl-4 pr-4 sm:pl-6 md:pl-8 md:pr-6 lg:pl-10 xl:pl-12 2xl:pl-20">
        <Carousel
          opts={{
            dragFree: true,
            containScroll: "trimSnaps",
            align: "start",
          }}
          data-testid="NavigationCarouselSwiper"
        >
          <CarouselContent className="-ml-5">
            {items.map((item, index) => (
              <CarouselItem
                key={item.id}
                className="max-w-[200px] pl-5"
                data-testid={`CarouselSlide-${item.contentId.split("/")[0]}`}
              >
                <NavCard item={item} index={index} />
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
    </div>
  )
}
