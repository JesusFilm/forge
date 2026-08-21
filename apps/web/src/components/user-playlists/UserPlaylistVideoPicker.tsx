"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Search, X } from "lucide-react"

import { runSearch } from "@/lib/search-actions"
import type { SearchResult } from "@/lib/search"

export function UserPlaylistVideoPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (video: { id: string; title: string }) => void
  onCancel: () => void
}) {
  const t = useTranslations("UserPlaylists")
  const headingId = useId()
  const searchSequence = useRef(0)
  const queryRef = useRef("")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<
    "idle" | "searching" | "ready" | "error"
  >("idle")

  useEffect(
    () => () => {
      searchSequence.current += 1
    },
    [],
  )

  async function search() {
    const trimmed = query.trim()
    if (trimmed.length < 2 || status === "searching") return
    const sequence = ++searchSequence.current
    setStatus("searching")
    try {
      const result = await runSearch({
        query: trimmed,
        limit: 12,
        offset: 0,
        type: "video",
      })
      if (
        sequence !== searchSequence.current ||
        queryRef.current.trim() !== trimmed
      ) {
        return
      }
      if (!result.ok) {
        setResults([])
        setStatus("error")
        return
      }
      setResults(result.results.filter((item) => item.type === "video"))
      setStatus("ready")
    } catch {
      if (
        sequence !== searchSequence.current ||
        queryRef.current.trim() !== trimmed
      ) {
        return
      }
      setResults([])
      setStatus("error")
    }
  }

  function cancel() {
    searchSequence.current += 1
    onCancel()
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-white/15 bg-black/30 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 id={headingId} className="font-semibold text-white">
            {t("picker.title")}
          </h4>
          <p className="mt-1 text-xs leading-5 text-stone-400">
            {t("picker.description")}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("picker.close")}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          onClick={cancel}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label className="sr-only" htmlFor={`${headingId}-query`}>
          {t("picker.searchLabel")}
        </label>
        <input
          id={`${headingId}-query`}
          value={query}
          maxLength={200}
          placeholder={t("picker.searchPlaceholder")}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/20 bg-stone-950 px-3 text-white placeholder:text-stone-500 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
          onChange={(event) => {
            const nextQuery = event.target.value
            queryRef.current = nextQuery
            searchSequence.current += 1
            setQuery(nextQuery)
            setResults([])
            setStatus("idle")
          }}
        />
        <button
          type="submit"
          disabled={query.trim().length < 2 || status === "searching"}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-black hover:bg-stone-200 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Search aria-hidden="true" />
          {status === "searching" ? t("picker.searching") : t("picker.search")}
        </button>
      </form>

      <div aria-live="polite" className="mt-4">
        {status === "error" ? (
          <p role="alert" className="text-sm text-red-200">
            {t("picker.error")}
          </p>
        ) : status === "ready" && results.length === 0 ? (
          <p className="text-sm text-stone-300">{t("picker.empty")}</p>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {results.map((video) => (
            <li key={video.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-white/15 bg-white/5 p-3 text-left hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:outline-none"
                onClick={() => onSelect({ id: video.id, title: video.title })}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">
                    {video.title}
                  </span>
                  {video.languageEnglishName ? (
                    <span className="mt-1 block truncate text-xs text-stone-400">
                      {video.languageEnglishName}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
