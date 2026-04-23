"use client"

import type { NavigationCarouselSection } from "@forge/experience-templates"

import { cn } from "@/lib/cn"
import { fixImageUrl } from "@/lib/mux"

type NavigationCarouselPreviewProps = {
  section: NavigationCarouselSection
}

function handleNavigationClick(contentId: string) {
  if (typeof document === "undefined") return
  const element = document.getElementById(contentId)
  element?.scrollIntoView({ behavior: "smooth", block: "start" })
}

export function NavigationCarouselPreview({
  section,
}: NavigationCarouselPreviewProps) {
  const items = (section.items ?? []).filter(
    (i): i is NonNullable<typeof i> => i != null,
  )

  if (items.length === 0) return null

  return (
    <div
      className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2"
      data-testid="NavigationCarouselPreview"
    >
      {items.map((item, i) => {
        const imageUrl = fixImageUrl(item.imageUrl)
        const bg = item.backgroundColor ?? "#1A1815"
        return (
          <button
            key={`${item.contentId}-${i}`}
            type="button"
            onClick={() => handleNavigationClick(item.contentId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                handleNavigationClick(item.contentId)
              }
            }}
            aria-label={`Scroll to ${item.title}`}
            className={cn(
              "relative flex h-40 w-36 shrink-0 snap-center flex-col justify-end overflow-hidden",
              "rounded-lg text-left text-white shadow-sm transition hover:scale-[1.02]",
              !imageUrl && "bg-neutral-800",
            )}
            style={{ backgroundColor: bg }}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={item.title}
                className="absolute inset-0 h-full w-full object-cover opacity-80"
              />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="relative z-10 space-y-0.5 p-3">
              {item.category ? (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-100/80">
                  {item.category}
                </span>
              ) : null}
              <h4 className="line-clamp-2 text-sm font-bold leading-tight text-white">
                {item.title}
              </h4>
            </div>
          </button>
        )
      })}
    </div>
  )
}
