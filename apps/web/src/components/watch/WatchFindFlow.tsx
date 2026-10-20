"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useId, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  languageVideosIndexPath,
  languagesIndexPath,
  tryAsLocaleSlug,
} from "@/lib/routes"
import { loadGlobalWatchLanguageOptions } from "@/lib/watch-interaction-loader"
import type {
  WatchFilmFinderCard,
  WatchFilmFinderDuration,
  WatchFilmFinderLaneId,
  WatchFilmFinderPage,
} from "@/lib/watch-film-finder"
import type { GlobalLanguageOption } from "@/lib/watch-language-switcher"
import { watchPath } from "@/lib/watch-paths"

// Editorial prompts only. Film identity, titles, runtime and artwork all come
// from the current Admin projection, never from the prototype's harvested data.
const LANES = [
  { id: "conversation", label: "Conversation starters" },
  { id: "seven-days", label: "Time with Jesus" },
  { id: "kids", label: "Watch with children" },
  { id: "questions", label: "Questions about faith" },
  { id: "getting-started", label: "Getting started" },
  { id: "women", label: "Stories of women" },
  { id: "animated", label: "Animated stories" },
  { id: "culture", label: "Faith and culture" },
] as const satisfies readonly { id: WatchFilmFinderLaneId; label: string }[]

export type WatchFindFlowProps = { languageSlug: string; locale: string }

type ResultState = {
  key: string
  status: "loading" | "ready" | "error"
  cards: WatchFilmFinderCard[]
  hasNextPage: boolean
  endCursor: string | null
}

/** Mounted only inside the open finder dialog. Answers remain ephemeral. */
export function WatchFindFlow({ languageSlug, locale }: WatchFindFlowProps) {
  const id = useId()
  const [audio, setAudio] = useState(languageSlug)
  const [lanes, setLanes] = useState<WatchFilmFinderLaneId[]>(() =>
    LANES.map((lane) => lane.id),
  )
  const [duration, setDuration] = useState<WatchFilmFinderDuration>("ANY")
  const [cursor, setCursor] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [catalog, setCatalog] = useState<{
    status: "loading" | "ready" | "error"
    options: GlobalLanguageOption[]
  }>({ status: "loading", options: [] })
  const [result, setResult] = useState<ResultState>({
    key: "",
    status: "loading",
    cards: [],
    hasNextPage: false,
    endCursor: null,
  })

  useEffect(() => {
    let cancelled = false
    setCatalog({ status: "loading", options: [] })
    void loadGlobalWatchLanguageOptions().then(
      (options) => {
        if (!cancelled) setCatalog({ status: "ready", options })
      },
      () => {
        if (!cancelled) setCatalog({ status: "error", options: [] })
      },
    )
    return () => {
      cancelled = true
    }
  }, [catalogAttempt])

  const params = new URLSearchParams({
    languageSlug: audio,
    duration,
    first: "24",
  })
  lanes.forEach((lane) => params.append("laneIds", lane))
  const key = params.toString()

  useEffect(() => {
    const controller = new AbortController()
    const requestParams = new URLSearchParams(key)
    if (cursor) requestParams.set("after", cursor)
    setResult((current) => ({
      key,
      status: "loading",
      cards: cursor && current.key === key ? current.cards : [],
      hasNextPage: false,
      endCursor: null,
    }))
    void (async () => {
      try {
        const response = await fetch(
          `${watchPath("/api/film-finder")}?${requestParams}`,
          {
            method: "GET",
            cache: "no-store",
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        )
        if (!response.ok) throw new FinderRequestError()
        const page: WatchFilmFinderPage = await response.json()
        if (controller.signal.aborted) return
        setResult((current) => {
          const previous = cursor && current.key === key ? current.cards : []
          const cards = [
            ...new Map(
              [...previous, ...page.cards].map((card) => [card.videoId, card]),
            ).values(),
          ]
          return {
            key,
            status: "ready",
            cards,
            hasNextPage: page.hasNextPage,
            endCursor: page.endCursor,
          }
        })
      } catch {
        if (controller.signal.aborted) return
        setResult((current) => ({ ...current, status: "error" }))
      }
    })()
    return () => controller.abort()
  }, [key, cursor, retry])

  // Hide old-language cards in the same render as a filter change, before the
  // effect aborts the obsolete request. An abort-ignoring transport is fenced too.
  const current =
    result.key === key
      ? result
      : { ...result, status: "loading" as const, cards: [] }
  const language = tryAsLocaleSlug(audio)
  const catalogHref = language
    ? languageVideosIndexPath(language)
    : languagesIndexPath()
  const selectedAudio = catalog.options.find((option) => option.slug === audio)
  const count = new Intl.NumberFormat(locale).format(current.cards.length)

  return (
    <div className="min-w-0 space-y-6" lang="en" dir="ltr">
      <p className="text-sm text-white/65">
        Choose an interest, the time you have, and audio for you or the person
        you are sharing with.
      </p>
      <fieldset className="space-y-3">
        <legend className="font-semibold">
          What would you like to explore?
        </legend>
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-4">
          {LANES.map((lane) => (
            <label
              key={lane.id}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/15 p-3 text-sm has-checked:border-white/60 has-checked:bg-white/10"
            >
              <input
                type="checkbox"
                checked={lanes.includes(lane.id)}
                disabled={lanes.length === 1 && lanes.includes(lane.id)}
                onChange={(event) => {
                  setCursor(null)
                  setLanes((current) =>
                    event.target.checked
                      ? [...current, lane.id]
                      : current.filter((id) => id !== lane.id),
                  )
                }}
                className="mt-0.5 accent-white"
              />
              {lane.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <label
            htmlFor={`${id}-audio`}
            className="block text-sm font-semibold"
          >
            Film audio
          </label>
          <select
            id={`${id}-audio`}
            name="audio"
            value={audio}
            disabled={catalog.status !== "ready"}
            onChange={(event) => {
              setCursor(null)
              setAudio(event.target.value)
            }}
            className="w-full min-w-0 rounded-lg border border-white/20 bg-stone-900 p-3 text-sm"
          >
            {!selectedAudio ? <option value={audio}>{audio}</option> : null}
            {catalog.options.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.englishName}
                {option.nativeName && option.nativeName !== option.englishName
                  ? ` — ${option.nativeName}`
                  : ""}
              </option>
            ))}
          </select>
          {catalog.status === "loading" ? (
            <p role="status" className="text-sm text-white/60">
              Loading audio languages…
            </p>
          ) : null}
          {catalog.status === "error" ? (
            <div className="text-sm text-white/70">
              <p>
                Other audio languages could not load. Your selected audio is
                unchanged.
              </p>
              <Button
                variant="ghost"
                onClick={() => setCatalogAttempt((value) => value + 1)}
              >
                Reload languages
              </Button>
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <label
            htmlFor={`${id}-duration`}
            className="block text-sm font-semibold"
          >
            Time available
          </label>
          <select
            id={`${id}-duration`}
            name="duration"
            value={duration}
            onChange={(event) => {
              setCursor(null)
              setDuration(event.target.value as WatchFilmFinderDuration)
            }}
            className="w-full rounded-lg border border-white/20 bg-stone-900 p-3 text-sm"
          >
            <option value="ANY">Any length</option>
            <option value="SHORT">Up to 6 minutes</option>
            <option value="MEDIUM">Up to 25 minutes</option>
          </select>
        </div>
      </div>
      <section
        aria-label="Matching films"
        aria-busy={current.status === "loading"}
        className="space-y-4"
      >
        <div aria-live="polite">
          {current.status === "loading" ? (
            <p role="status">Loading films…</p>
          ) : null}
          {current.status === "ready" && current.cards.length === 0 ? (
            <p>
              No films match this audio and time in the selected collections.
              Try another interest or time, or browse the catalog.
            </p>
          ) : null}
          {current.cards.length > 0 ? (
            <h3 className="text-lg font-semibold">
              {count} {current.cards.length === 1 ? "film" : "films"} available
            </h3>
          ) : null}
          {current.cards.length > 0 ? (
            <p className="mt-2 text-sm text-white/65">
              Titles shared by collections appear once. These films have
              playable audio in your selection.
            </p>
          ) : null}
        </div>
        {current.status === "error" ? (
          <div role="alert" className="space-y-2">
            <p>Films are temporarily unavailable. Please try again.</p>
            <Button
              variant="secondary"
              onClick={() => setRetry((value) => value + 1)}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {current.cards.length > 0 ? (
          <ul className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 sm:grid-cols-3">
            {current.cards.map((card) => (
              <li
                key={card.videoId}
                data-testid="watch-finder-card"
                className="min-w-0"
              >
                <Link
                  href={card.href}
                  prefetch={false}
                  className="group block overflow-hidden rounded-xl border border-white/15 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                >
                  <div className="relative aspect-video bg-white/5">
                    {card.imageUrl ? (
                      <Image
                        src={card.imageUrl}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 45vw, 280px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="space-y-1 p-3">
                    <h4 className="font-semibold break-words group-hover:underline">
                      {card.title}
                    </h4>
                    <p className="text-sm text-white/60">
                      {card.durationSeconds === null
                        ? "Runtime unavailable"
                        : formatRuntime(card.durationSeconds, locale)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {current.status === "ready" &&
        current.hasNextPage &&
        current.endCursor ? (
          <Button
            variant="secondary"
            onClick={() => setCursor(current.endCursor)}
          >
            Load more
          </Button>
        ) : null}
        <Link
          href={catalogHref}
          prefetch={false}
          data-testid="watch-finder-catalog"
          className="inline-block text-sm underline underline-offset-4"
        >
          Browse the catalog in this audio language
        </Link>
      </section>
    </div>
  )
}

class FinderRequestError extends Error {
  constructor() {
    super("Film finder request failed")
    this.name = "FinderRequestError"
  }
}

function formatRuntime(seconds: number, locale: string) {
  const minutes = new Intl.NumberFormat(locale).format(Math.floor(seconds / 60))
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}
