"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Check, ChevronDown, Languages } from "lucide-react"

import { languageInventoryPath, tryAsLocaleSlug } from "@/lib/routes"
import type { WatchLanguageInventorySwitcherLanguage } from "@/lib/watch-language-inventory"

type LanguageCollectionSwitcherProps = {
  currentLanguageName: string
  currentNativeName: string | null
  currentSlug: string
  languages: WatchLanguageInventorySwitcherLanguage[]
  totalItems: number
}

const MAX_VISIBLE_LANGUAGES = 80

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value)
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

function searchableText(language: WatchLanguageInventorySwitcherLanguage) {
  return [
    language.languageName,
    language.nativeName,
    language.slug,
    language.bcp47,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function LanguageCollectionSwitcher({
  currentLanguageName,
  currentNativeName,
  currentSlug,
  languages,
  totalItems,
}: LanguageCollectionSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const options = useMemo(() => {
    if (languages.length > 0) return languages
    return [
      {
        slug: currentSlug,
        languageName: currentLanguageName,
        nativeName: currentNativeName,
        bcp47: null,
      },
    ]
  }, [currentLanguageName, currentNativeName, currentSlug, languages])
  const currentLanguage =
    options.find((language) => language.slug === currentSlug) ?? options[0]
  const normalizedQuery = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!normalizedQuery) return options
    return options.filter((language) =>
      searchableText(language).includes(normalizedQuery),
    )
  }, [normalizedQuery, options])
  const visibleLanguages = matches.slice(0, MAX_VISIBLE_LANGUAGES)
  const hiddenMatchCount = Math.max(0, matches.length - visibleLanguages.length)

  return (
    <div className="mb-5 max-w-md" data-testid="language-collection-switcher">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="language-collection-switcher-panel"
        aria-label="Switch language collection"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-full border border-amber-200/25 bg-amber-200/10 px-4 py-2.5 text-left text-amber-50 shadow-lg shadow-black/20 backdrop-blur transition hover:border-amber-200/45 hover:bg-amber-200/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-100 text-stone-950">
          <Languages className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] leading-none font-bold tracking-wide text-amber-100/75 uppercase">
            Language collection
          </span>
          <span className="mt-1 block truncate text-base leading-tight font-black">
            {currentLanguage?.languageName ?? currentLanguageName}
          </span>
          {currentLanguage?.nativeName ? (
            <span className="mt-0.5 block truncate text-xs font-semibold text-amber-100/70">
              {currentLanguage.nativeName}
            </span>
          ) : null}
        </span>
        <span className="ml-auto hidden shrink-0 rounded-full border border-amber-100/25 px-2.5 py-1 text-xs font-bold text-amber-100/90 sm:inline-flex">
          {pluralize(totalItems, "item")}
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-amber-100/70 transition ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id="language-collection-switcher-panel"
          className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-stone-950/95 shadow-2xl shadow-black/35 backdrop-blur"
        >
          <div className="border-b border-white/10 px-3 py-3">
            <label
              htmlFor="language-collection-switcher-search"
              className="sr-only"
            >
              Search language collections
            </label>
            <input
              id="language-collection-switcher-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search language collections"
              className="h-10 w-full rounded border border-white/10 bg-white/[0.06] px-3 text-sm font-semibold text-stone-100 placeholder:text-stone-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1 [scrollbar-color:theme(colors.stone.700)_transparent] [scrollbar-width:thin]">
            {visibleLanguages.length > 0 ? (
              visibleLanguages.map((language) => {
                const selected = language.slug === currentSlug
                const lang = tryAsLocaleSlug(language.slug)
                const content = (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-stone-100">
                        {language.languageName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-stone-400">
                        {language.nativeName ?? language.slug}
                      </span>
                    </span>
                    {selected ? (
                      <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200/35 px-2 py-1 text-[11px] font-bold text-amber-100">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Current
                      </span>
                    ) : null}
                  </>
                )
                const className =
                  "flex min-h-14 w-full items-center gap-3 rounded px-3 py-2 text-left transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"

                if (selected || !lang) {
                  return (
                    <div
                      key={language.slug}
                      aria-current={selected ? "page" : undefined}
                      className={className}
                    >
                      {content}
                    </div>
                  )
                }

                return (
                  <Link
                    key={language.slug}
                    href={languageInventoryPath(lang)}
                    className={className}
                    onClick={() => setOpen(false)}
                  >
                    {content}
                  </Link>
                )
              })
            ) : (
              <div className="px-3 py-4 text-sm font-semibold text-stone-400">
                No language collections match that search.
              </div>
            )}
          </div>
          {hiddenMatchCount > 0 ? (
            <div className="border-t border-white/10 px-3 py-2 text-xs font-semibold text-stone-400">
              {pluralize(hiddenMatchCount, "more match", "more matches")}. Keep
              typing to narrow the list.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
