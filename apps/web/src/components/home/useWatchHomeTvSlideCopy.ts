"use client"

import { useFormatter, useTranslations } from "next-intl"
import type { WatchHomeTvCarouselMuxSlide } from "@/lib/watch-home-carousel-sequence"
import type { WatchHomeTvCarouselSlide } from "@/components/home/useWatchHomeTvCarousel"

const WATCH_HOME_MUX_COPY_KEYS = {
  welcomeStart: {
    label: "welcomeStart.label",
    title: "welcomeStart.title",
    description: "welcomeStart.description",
  },
  welcomeMorning: {
    label: "welcomeMorning.label",
    title: "welcomeMorning.title",
    description: "welcomeMorning.description",
  },
  welcomeAfternoon: {
    label: "welcomeAfternoon.label",
    title: "welcomeAfternoon.title",
    description: "welcomeAfternoon.description",
  },
  welcomeEvening: {
    label: "welcomeEvening.label",
    title: "welcomeEvening.title",
    description: "welcomeEvening.description",
  },
  joinUs: {
    label: "joinUs.label",
    title: "joinUs.title",
    description: "joinUs.description",
  },
  tellingTheStoryOfJesus: {
    label: "tellingTheStoryOfJesus.label",
    title: "tellingTheStoryOfJesus.title",
    description: "tellingTheStoryOfJesus.description",
  },
} as const satisfies Record<
  WatchHomeTvCarouselMuxSlide["copyId"],
  { label: string; title: string; description: string }
>

const WATCH_HOME_MUX_ACTION_KEYS = {
  joinUs: "actions.joinUs",
  shareMission: "actions.shareMission",
} as const satisfies Record<
  NonNullable<WatchHomeTvCarouselMuxSlide["action"]>["copyId"],
  string
>

export function watchHomeMuxActionMessageKey(
  copyId: NonNullable<WatchHomeTvCarouselMuxSlide["action"]>["copyId"],
): string {
  return WATCH_HOME_MUX_ACTION_KEYS[copyId]
}

export function useWatchHomeTvSlideCopy(slide: WatchHomeTvCarouselSlide) {
  const format = useFormatter()
  const muxCopy = useTranslations("WatchHomeMuxInserts")

  if (slide.kind === "video") {
    return {
      description: slide.description,
      imageAlt: slide.imageAlt,
      label: slide.label,
      title: slide.title,
    }
  }

  if (slide.kind === "promo") {
    return {
      description: slide.description,
      imageAlt: slide.title,
      label: slide.label ?? "",
      title: slide.title,
    }
  }

  const keys = WATCH_HOME_MUX_COPY_KEYS[slide.copyId]
  const title = muxCopy(keys.title)
  const localizedTitle = slide.titleDate
    ? muxCopy("datedTitle", {
        date: format.dateTime(new Date(slide.titleDate), {
          day: "numeric",
          month: "short",
          timeZone: "America/New_York",
        }),
        title,
      })
    : title

  return {
    description: muxCopy(keys.description),
    imageAlt: localizedTitle,
    label: muxCopy(keys.label),
    title: localizedTitle,
  }
}
