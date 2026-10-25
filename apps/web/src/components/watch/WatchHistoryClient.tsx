"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { Clock3, Play } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"

import {
  VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
  VideoThumbnailInteractionFrame,
} from "@/components/ui/video-thumbnail-interaction-frame"
import {
  getWatchProgressRatio,
  loadWatchProgressHistory,
  type WatchProgressEntry,
} from "@/lib/watch-progress-client"
import type {
  WatchHistoryItem,
  WatchHistoryVideoDetails,
} from "@/lib/watch-history"
import { cn } from "@/lib/utils"
import { videoLabelMessageKey } from "@/lib/video-labels"

type VideoState =
  | { status: "loading"; videos: WatchHistoryVideoDetails[] }
  | { status: "ready"; videos: WatchHistoryVideoDetails[] }
  | { status: "error"; videos: WatchHistoryVideoDetails[] }

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dayDiff(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round(
    (startOfDay(a).getTime() - startOfDay(b).getTime()) / msPerDay,
  )
}

type DateHeadingFormatters = {
  shortDate: Intl.DateTimeFormat
  weekday: Intl.DateTimeFormat
}

function dateHeading(
  value: number,
  locale: string,
  labels: { earlier: string; today: string; yesterday: string },
  formatters: DateHeadingFormatters,
  now = new Date(),
): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return labels.earlier

  const diff = dayDiff(now, date)
  if (diff === 0) return labels.today
  if (diff === 1) return labels.yesterday
  if (diff > 1 && diff < 7) {
    return formatters.weekday.format(date)
  }
  return formatters.shortDate.format(date).toLocaleUpperCase(locale)
}

function groupHistory(
  items: WatchHistoryItem[],
  headingForDate: (value: number) => string,
) {
  const groups = new Map<string, WatchHistoryItem[]>()
  for (const item of items) {
    const heading = headingForDate(Date.parse(item.watchedAt))
    const existingGroup = groups.get(heading)
    if (existingGroup) {
      existingGroup.push(item)
    } else {
      groups.set(heading, [item])
    }
  }
  return Array.from(groups.entries()).map(([heading, groupItems]) => ({
    heading,
    items: groupItems,
  }))
}

function mergeProgressAndVideos(
  progress: WatchProgressEntry[],
  videos: WatchHistoryVideoDetails[],
): WatchHistoryItem[] {
  const videoById = new Map(videos.map((video) => [video.videoId, video]))
  return progress.flatMap((entry) => {
    const video = videoById.get(entry.videoId)
    if (!video) return []
    return [
      {
        ...video,
        progressPercent: Math.round(getWatchProgressRatio(entry) * 100),
        watchedAt: new Date(entry.updatedAt).toISOString(),
      },
    ]
  })
}

export function WatchHistoryClient() {
  const locale = useLocale()
  const t = useTranslations("WatchHistory")
  const [progress, setProgress] = useState<WatchProgressEntry[]>([])
  const [videoState, setVideoState] = useState<VideoState>({
    status: "loading",
    videos: [],
  })

  useEffect(() => {
    let cancelled = false
    void loadWatchProgressHistory<WatchHistoryVideoDetails>()
      .then((result) => {
        if (!cancelled) {
          setProgress(result.entries)
          setVideoState({ status: "ready", videos: result.videos })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVideoState({ status: "error", videos: [] })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const items = useMemo(
    () =>
      videoState.status === "loading" && videoState.videos.length === 0
        ? []
        : mergeProgressAndVideos(progress, videoState.videos),
    [progress, videoState],
  )
  const groups = useMemo(() => {
    const labels = {
      earlier: t("earlier"),
      today: t("today"),
      yesterday: t("yesterday"),
    }
    const formatters: DateHeadingFormatters = {
      shortDate: new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "2-digit",
      }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: "long" }),
    }
    return groupHistory(items, (value) =>
      dateHeading(value, locale, labels, formatters),
    )
  }, [items, locale, t])

  if (videoState.status === "loading" && groups.length === 0) {
    return (
      <div className="mt-10 rounded-lg border border-white/10 bg-white/[0.04] p-8 text-stone-300">
        <Clock3 aria-hidden="true" className="mb-4 h-8 w-8 text-stone-400" />
        <p className="text-lg font-semibold text-white">{t("loading")}</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="mt-10 rounded-lg border border-white/10 bg-white/[0.04] p-8 text-stone-300">
        <Clock3 aria-hidden="true" className="mb-4 h-8 w-8 text-stone-400" />
        <p className="text-lg font-semibold text-white">{t("empty")}</p>
        <p className="mt-2 max-w-xl text-base sm:text-sm leading-6">
          {t("emptyDescription")}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-10 space-y-10">
      {groups.map((group) => (
        <section key={group.heading} aria-label={group.heading}>
          <h2 className="mb-4 text-base sm:text-sm font-bold tracking-[0.22em] text-stone-400 uppercase">
            {group.heading}
          </h2>
          <div className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
            {group.items.map((item) => (
              <HistoryRow key={item.videoId} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function HistoryRow({ item }: { item: WatchHistoryItem }) {
  const videoLabels = useTranslations("VideoLabels")
  const content = (
    <div
      className={cn(
        "grid grid-cols-[7rem_1fr] gap-4 p-3 transition-colors sm:grid-cols-[10rem_1fr] sm:gap-5 sm:p-4",
        item.href && "hover:bg-white/[0.04]",
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-md bg-stone-900">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.imageAlt}
            fill
            sizes="(max-width: 640px) 112px, 160px"
            className="object-cover"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
        <div className="absolute right-2 bottom-2 left-2 h-1 overflow-hidden rounded-full bg-black/55">
          <div
            className="h-full rounded-full bg-brand-red"
            style={{ width: `${item.progressPercent}%` }}
          />
        </div>
        {item.href ? (
          <VideoThumbnailInteractionFrame data-testid="watch-history-thumbnail-frame" />
        ) : null}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 text-xs font-semibold tracking-[0.18em] text-stone-400 uppercase sm:text-[10px]">
            {videoLabels(videoLabelMessageKey(item.label))}
          </div>
          <h3 className="line-clamp-2 text-base leading-snug font-semibold text-white sm:text-lg">
            {item.title}
          </h3>
        </div>
        {item.href ? (
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black sm:flex">
            <Play aria-hidden="true" className="h-4 w-4 fill-current" />
          </div>
        ) : null}
      </div>
    </div>
  )

  return item.href ? (
    <Link
      href={item.href as Route}
      className={cn(
        "group block text-inherit no-underline",
        VIDEO_THUMBNAIL_FOCUS_TARGET_CLASS,
      )}
    >
      {content}
    </Link>
  ) : (
    <div>{content}</div>
  )
}
