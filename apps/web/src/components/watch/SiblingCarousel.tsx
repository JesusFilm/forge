"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useParams } from "next/navigation"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import { cn } from "@/lib/utils"
import type { WatchSiblingCarouselBlock } from "@/lib/content"

export function SiblingCarousel({
  block,
}: {
  block: WatchSiblingCarouselBlock
}) {
  const { canonicalParent, currentVideoDocumentId } = block

  const params = useParams<{ locale?: string }>()
  const currentLocale = params?.locale ?? ""

  const children = (canonicalParent.children ?? []).filter(
    (child): child is NonNullable<typeof child> => child != null,
  )

  const activeIndex = children.findIndex(
    (child) => child.documentId === currentVideoDocumentId,
  )
  const clipIndex = activeIndex >= 0 ? activeIndex + 1 : 1
  const clipTotal = children.length

  const [api, setApi] = useState<CarouselApi | null>(null)

  // Snap to active item once on mount. Depend on `api` only (not
  // `activeIndex`) so re-renders don't yank the user's scroll position back.
  const initialActiveIndex = useRef(activeIndex)
  useEffect(() => {
    if (!api) return
    const idx = initialActiveIndex.current
    if (idx < 0) return
    api.scrollTo(idx, true)
  }, [api])

  if (children.length < 2) return null

  return (
    <section
      data-block-type="SiblingCarousel"
      className="relative w-full px-4 py-8 md:px-8"
      aria-label={`${canonicalParent.title ?? "Collection"} · Clip ${clipIndex} of ${clipTotal}`}
    >
      <header className="mb-4">
        <p className="text-sm font-medium text-stone-300">
          <span className="text-stone-100">
            {canonicalParent.title ?? "Collection"}
          </span>
          <span className="px-2 text-stone-500">·</span>
          <span data-testid="sibling-carousel-label">
            Clip {clipIndex} of {clipTotal}
          </span>
        </p>
      </header>

      <Carousel
        opts={{ align: "start", containScroll: "trimSnaps" }}
        setApi={setApi}
        className="w-full"
      >
        <CarouselContent>
          {children.map((child, index) => {
            const isActive = index === activeIndex
            const thumb = child.images?.[0]?.url ?? null
            const href =
              `/${canonicalParent.slug}/${child.slug}/${currentLocale}` as Route

            return (
              <CarouselItem
                key={child.documentId}
                className="basis-[55%] sm:basis-[40%] md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
                aria-current={isActive ? "true" : undefined}
              >
                <Link
                  href={href}
                  data-testid="sibling-carousel-item"
                  data-active={isActive ? "true" : "false"}
                  data-href={href}
                  className={cn(
                    "group block overflow-hidden rounded-lg bg-stone-800 transition",
                    isActive
                      ? "ring-2 ring-amber-400"
                      : "opacity-70 hover:opacity-100",
                  )}
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-stone-900">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={child.title ?? ""}
                        fill
                        sizes="(max-width: 640px) 55vw, (max-width: 768px) 40vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
                        className="object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div
                        data-testid="sibling-carousel-thumb-placeholder"
                        className="flex h-full items-center justify-center text-xs text-stone-600"
                      >
                        No image
                      </div>
                    )}
                    {isActive ? (
                      <span
                        data-testid="sibling-carousel-playing-now"
                        className="absolute left-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-stone-950"
                      >
                        Playing now
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1 p-3">
                    <h3 className="line-clamp-2 text-sm font-semibold text-white">
                      {child.title ?? ""}
                    </h3>
                    {child.label ? (
                      <p className="text-xs uppercase tracking-wide text-stone-400">
                        {child.label}
                      </p>
                    ) : null}
                  </div>
                </Link>
              </CarouselItem>
            )
          })}
        </CarouselContent>

        <CarouselPrevious className="hidden md:inline-flex" />
        <CarouselNext className="hidden md:inline-flex" />
      </Carousel>
    </section>
  )
}
