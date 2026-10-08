"use client"

import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { useLocale, useTranslations } from "next-intl"

import {
  getWatchProgressRatio,
  useWatchProgressEntries,
} from "@/lib/watch-progress-client"
import { formatDuration } from "@/lib/format-duration"
import {
  asLocaleSlug,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "@/lib/routes"

export type WatchContinueWatchingItem = {
  videoId: string
  title: string
  videoSlug: string
  languageSlug: string | null
  imageUrl: string | null
}

export function WatchContinueWatchingRail({
  items,
  fallbackLanguageSlug,
}: {
  items: WatchContinueWatchingItem[]
  fallbackLanguageSlug: string
}) {
  const locale = useLocale()
  const t = useTranslations("WatchHistory")
  const progressEntries = useWatchProgressEntries()
  const itemsByVideoId = new Map(items.map((item) => [item.videoId, item]))
  const resumeItems = progressEntries
    .flatMap((entry) => {
      const item = itemsByVideoId.get(entry.videoId)
      const ratio = getWatchProgressRatio(entry)
      if (!item || ratio <= 0 || ratio >= 1) return []
      return [{ item, entry }]
    })
    .sort((left, right) => right.entry.updatedAt - left.entry.updatedAt)
    .slice(0, 8)

  if (resumeItems.length === 0) return null

  const minuteLabel = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "minute",
    unitDisplay: "short",
  })

  return (
    <section
      aria-label={t("title")}
      data-testid="continue-watching-rail"
      className="mx-auto w-full max-w-[1440px] px-4 pt-5 sm:px-6 md:px-8"
    >
      <h2 className="mb-3 text-lg font-semibold text-white sm:text-xl">
        {t("title")}
      </h2>
      <div className="flex snap-x gap-3 overflow-x-auto pb-3">
        {resumeItems.map(({ item, entry }) => {
          const contentSlug = tryAsContentSlug(item.videoSlug)
          if (!contentSlug) return null
          const languageSlug =
            tryAsLocaleSlug(entry.languageSlug ?? item.languageSlug ?? "") ??
            tryAsLocaleSlug(fallbackLanguageSlug) ??
            asLocaleSlug("english")
          const href = watchVideoPath(contentSlug, languageSlug) as Route
          const remainingSeconds = Math.max(
            0,
            entry.durationSeconds - entry.positionSeconds,
          )
          const remainingMinutes = Math.ceil(remainingSeconds / 60)

          return (
            <Link
              key={item.videoId}
              href={href}
              data-testid="continue-watching-card"
              className="group relative block w-[72vw] max-w-64 shrink-0 snap-start overflow-hidden rounded-lg border border-white/10 bg-neutral-900 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:w-56"
            >
              <div className="relative aspect-video overflow-hidden">
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 72vw, 224px"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="h-full w-full bg-neutral-800" />
                )}
                <div
                  aria-hidden="true"
                  className="absolute right-0 bottom-0 left-0 h-1.5 bg-white/25"
                >
                  <div
                    className="h-full bg-brand-red"
                    style={{
                      width: `${Math.round(getWatchProgressRatio(entry) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0 truncate text-sm font-medium">
                  {item.title}
                </span>
                <time
                  aria-label={`${formatDuration(remainingSeconds)} · ${minuteLabel.format(remainingMinutes)}`}
                  className="shrink-0 text-xs text-white/75"
                >
                  {minuteLabel.format(remainingMinutes)}
                </time>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
