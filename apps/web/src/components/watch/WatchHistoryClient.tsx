"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import type { Route } from "next"
import { Clock3, Play } from "lucide-react"

import {
  getWatchProgressRatio,
  loadWatchProgressHistory,
  type WatchProgressEntry,
} from "@/lib/watch-progress-client"
import type {
  WatchHistoryItem,
  WatchHistoryVideoDetails,
} from "@/lib/watch-history"

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

function dateHeading(value: number, now = new Date()): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Earlier"

  const diff = dayDiff(now, date)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff > 1 && diff < 7) {
    return new Intl.DateTimeFormat("en", { weekday: "long" }).format(date)
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
  })
    .format(date)
    .replace(",", "")
    .toUpperCase()
}

function groupHistory(items: WatchHistoryItem[]) {
  const groups = new Map<string, WatchHistoryItem[]>()
  for (const item of items) {
    const heading = dateHeading(Date.parse(item.watchedAt))
    groups.set(heading, [...(groups.get(heading) ?? []), item])
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
  const groups = groupHistory(items)

  if (videoState.status === "loading" && groups.length === 0) {
    return (
      <div className="mt-10 rounded-lg border border-white/10 bg-white/[0.04] p-8 text-stone-300">
        <Clock3 aria-hidden="true" className="mb-4 h-8 w-8 text-stone-400" />
        <p className="text-lg font-semibold text-white">Loading history</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="mt-10 rounded-lg border border-white/10 bg-white/[0.04] p-8 text-stone-300">
        <Clock3 aria-hidden="true" className="mb-4 h-8 w-8 text-stone-400" />
        <p className="text-lg font-semibold text-white">Nothing here yet</p>
        <p className="mt-2 max-w-xl text-sm leading-6">
          Videos you watch while signed in will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-10 space-y-10">
      {groups.map((group) => (
        <section key={group.heading} aria-label={group.heading}>
          <h2 className="mb-4 text-sm font-bold tracking-[0.22em] text-stone-400 uppercase">
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
  const content = (
    <div className="grid grid-cols-[7rem_1fr] gap-4 p-3 transition-colors hover:bg-white/[0.04] sm:grid-cols-[10rem_1fr] sm:gap-5 sm:p-4">
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
      </div>

      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-semibold tracking-[0.18em] text-stone-400 uppercase">
            {item.label}
          </div>
          <h3 className="line-clamp-2 text-base leading-snug font-semibold text-white sm:text-lg">
            {item.title}
          </h3>
        </div>
        <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black sm:flex">
          <Play aria-hidden="true" className="h-4 w-4 fill-current" />
        </div>
      </div>
    </div>
  )

  return item.href ? (
    <Link href={item.href as Route} className="block text-inherit no-underline">
      {content}
    </Link>
  ) : (
    <div>{content}</div>
  )
}
