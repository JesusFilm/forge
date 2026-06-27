"use client"

import Link from "next/link"
import type { Route } from "next"
import { ArrowRight, ChevronDown, Globe2, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import type {
  WatchLanguageIndexLanguage,
  WatchLanguageIndexRegion,
} from "@/lib/language-index"

type WatchLanguageIndexBrowserProps = {
  languages: WatchLanguageIndexLanguage[]
  regions: WatchLanguageIndexRegion[]
}

type RegionArtwork = {
  image: string
}

const REGION_ARTWORK: Record<string, RegionArtwork> = {
  Africa: {
    image: "/watch/images/languages/region-africa.jpg",
  },
  Asia: {
    image: "/watch/images/languages/region-asia.jpg",
  },
  Europe: {
    image: "/watch/images/languages/region-europe.jpg",
  },
  "North America": {
    image: "/watch/images/languages/region-north-america.jpg",
  },
  Oceania: {
    image: "/watch/images/languages/region-oceania.jpg",
  },
  "South America": {
    image: "/watch/images/languages/region-south-america.jpg",
  },
}

const FALLBACK_REGION_ARTWORK: RegionArtwork = {
  image: "/watch/images/languages/region-oceania.jpg",
}
const COUNTRY_LANGUAGE_PREVIEW_COUNT = 4

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatLanguageCount(value: number): string {
  return `${formatCount(value)} ${value === 1 ? "language" : "languages"}`
}

function languageMatchesQuery(
  language: WatchLanguageIndexLanguage,
  query: string,
): boolean {
  if (!query) return true
  return (
    normalizeText(language.englishLabel).includes(query) ||
    normalizeText(language.nativeLabel).includes(query) ||
    normalizeText(language.publicSlug.replace(/-/g, " ")).includes(query)
  )
}

export function WatchLanguageIndexBrowser({
  languages,
  regions,
}: WatchLanguageIndexBrowserProps) {
  const [searchValue, setSearchValue] = useState("")
  const [expandedCountryKeys, setExpandedCountryKeys] = useState<
    ReadonlySet<string>
  >(new Set())

  const normalizedSearch = normalizeText(searchValue)
  const filteredLanguages = useMemo(
    () =>
      languages.filter((language) =>
        languageMatchesQuery(language, normalizedSearch),
      ),
    [languages, normalizedSearch],
  )
  const filteredLanguageSlugs = useMemo(
    () => new Set(filteredLanguages.map((language) => language.publicSlug)),
    [filteredLanguages],
  )
  const regionGroups = useMemo(
    () =>
      regions
        .map((region) => {
          const filteredRegionLanguages = region.languages.filter((language) =>
            filteredLanguageSlugs.has(language.publicSlug),
          )
          const countries = region.countries
            .map((country) => ({
              ...country,
              languages: country.languages.filter((language) =>
                filteredLanguageSlugs.has(language.publicSlug),
              ),
            }))
            .filter((country) => country.languages.length > 0)

          return {
            ...region,
            languages: filteredRegionLanguages,
            countries,
          }
        })
        .filter((region) => region.countries.length > 0),
    [filteredLanguageSlugs, regions],
  )
  const toggleCountryExpansion = (countryKey: string) => {
    setExpandedCountryKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys)
      if (nextKeys.has(countryKey)) {
        nextKeys.delete(countryKey)
      } else {
        nextKeys.add(countryKey)
      }
      return nextKeys
    })
  }

  return (
    <section
      className="relative isolate mx-auto w-full max-w-[112rem] rounded-xl bg-black font-sans text-stone-100 shadow-[0_32px_90px_rgba(0,0,0,0.48)] ring-1 ring-white/10"
      aria-labelledby="language-index-title"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20 rounded-xl bg-[radial-gradient(circle_at_18%_12%,rgba(239,51,64,0.2),transparent_28%),radial-gradient(circle_at_82%_4%,rgba(251,191,36,0.12),transparent_24%),linear-gradient(135deg,#020202,#171412_44%,#050505)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 rounded-xl bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-35 mix-blend-soft-light"
      />
      <header className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-black/50 px-5 py-5 backdrop-blur-xl sm:px-7">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-amber-200 ring-1 ring-white/15">
          <Globe2 className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 mb-1 text-xs font-bold tracking-[0.24em] text-red-100/70 uppercase">
            Watch languages
          </p>
          <h1
            id="language-index-title"
            className="m-0 truncate text-2xl leading-tight font-bold tracking-normal text-white sm:text-3xl"
          >
            Choose a language
          </h1>
          <p className="m-0 mt-1 text-sm leading-tight font-semibold text-stone-300/80 sm:text-base">
            Explore languages by region or browse the full list.
          </p>
        </div>
      </header>

      <div>
        <div className="shrink-0 border-b border-white/10 bg-black/35 px-4 py-4 backdrop-blur-xl sm:px-6 md:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-3xl">
              <Search
                className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-white/70"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search languages..."
                aria-label="Search languages"
                className="h-14 w-full rounded-[35px] border border-white/10 bg-white/10 pr-12 pl-[3.25rem] text-base font-semibold text-white shadow-xl shadow-black/20 outline-none backdrop-blur-[10px] transition-colors placeholder:text-white/55 hover:bg-white/15 focus:border-white/35 focus:ring-2 focus:ring-white/40"
              />
              {searchValue ? (
                <button
                  type="button"
                  className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-stone-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
                  onClick={() => setSearchValue("")}
                  aria-label="Clear search"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <p
              className="m-0 w-fit shrink-0 rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-stone-200"
              aria-live="polite"
            >
              {formatCount(filteredLanguages.length)} languages
            </p>
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6 md:px-8">
          <div className="mb-5">
            <p className="m-0 text-xs font-bold tracking-[0.24em] text-red-100/70 uppercase">
              Browse
            </p>
            <h2 className="m-0 mt-1 text-xl leading-tight font-bold text-white sm:text-2xl">
              Browse by region and country
            </h2>
          </div>

          {regionGroups.length > 0 ? (
            <div className="flex flex-col gap-5">
              {regionGroups.map((region) => {
                const artwork =
                  REGION_ARTWORK[region.name] ?? FALLBACK_REGION_ARTWORK
                return (
                  <article
                    key={region.name}
                    className="grid rounded-xl bg-white/[0.045] shadow-xl shadow-stone-950/55 ring-1 ring-white/10 lg:grid-cols-[minmax(16rem,24rem)_minmax(0,1fr)] lg:items-start"
                  >
                    <div className="beveled relative min-h-48 overflow-hidden rounded-t-xl bg-black lg:sticky lg:top-28 lg:min-h-[26rem] lg:rounded-t-none lg:rounded-l-xl">
                      <span
                        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-90 saturate-125"
                        style={{ backgroundImage: `url(${artwork.image})` }}
                        aria-hidden="true"
                      />
                      <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                      <span className="absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-25 mix-blend-soft-light" />
                      <div className="relative z-[1] flex h-full min-h-48 flex-col justify-end p-5 lg:min-h-[26rem]">
                        <span className="mb-3 w-fit rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold tracking-[0.2em] text-amber-200 uppercase backdrop-blur-sm">
                          Region
                        </span>
                        <h3 className="m-0 text-3xl leading-none font-bold text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]">
                          {region.name}
                        </h3>
                        <p className="m-0 mt-2 text-lg leading-none font-bold text-stone-200 [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]">
                          {formatLanguageCount(region.languages.length)}
                        </p>
                      </div>
                    </div>

                    <div className="min-w-0 p-4 sm:p-5">
                      <div className="divide-y divide-white/10">
                        {region.countries.map((country) => {
                          const countryKey = `${region.name}:${country.id}`
                          const isExpanded = expandedCountryKeys.has(countryKey)
                          const visibleLanguages = isExpanded
                            ? country.languages
                            : country.languages.slice(
                                0,
                                COUNTRY_LANGUAGE_PREVIEW_COUNT,
                              )
                          const hiddenLanguageCount = Math.max(
                            0,
                            country.languages.length -
                              COUNTRY_LANGUAGE_PREVIEW_COUNT,
                          )
                          const extraLanguagesId = `country-languages-${countryKey.replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`

                          return (
                            <section
                              key={countryKey}
                              className="py-4 first:pt-0 last:pb-0"
                              aria-label={`${country.name} languages`}
                            >
                              <div className="mb-3 flex items-center gap-3">
                                {country.flagPngSrc ? (
                                  <span
                                    className="size-8 shrink-0 rounded-full bg-cover bg-center bg-no-repeat ring-1 ring-white/25"
                                    style={{
                                      backgroundImage: `url(${country.flagPngSrc})`,
                                    }}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <span
                                    className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-amber-200"
                                    aria-hidden="true"
                                  >
                                    <Globe2 className="size-4" />
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <h4 className="m-0 truncate text-lg leading-tight font-bold text-white">
                                    {country.name}
                                  </h4>
                                  <p className="m-0 mt-0.5 text-sm leading-tight font-semibold text-stone-400">
                                    {formatLanguageCount(
                                      country.languages.length,
                                    )}
                                  </p>
                                </div>
                              </div>

                              <div
                                id={
                                  hiddenLanguageCount > 0
                                    ? extraLanguagesId
                                    : undefined
                                }
                                className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3"
                              >
                                {visibleLanguages.map((language) => (
                                  <Link
                                    key={`${countryKey}-${language.publicSlug}`}
                                    href={language.href as Route}
                                    className="group flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left text-stone-100 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-base leading-tight font-bold">
                                        {language.englishLabel}
                                      </span>
                                      <span className="mt-1 block truncate text-sm leading-tight font-semibold text-stone-400">
                                        {language.nativeLabel}
                                      </span>
                                    </span>
                                    <ArrowRight
                                      className="size-4 shrink-0 text-amber-200 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                                      aria-hidden="true"
                                    />
                                  </Link>
                                ))}
                              </div>

                              {hiddenLanguageCount > 0 ? (
                                <button
                                  type="button"
                                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-bold text-amber-100 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
                                  aria-controls={extraLanguagesId}
                                  aria-expanded={isExpanded}
                                  onClick={() =>
                                    toggleCountryExpansion(countryKey)
                                  }
                                >
                                  {isExpanded
                                    ? "Show less"
                                    : `Show ${formatCount(hiddenLanguageCount)} more`}
                                  <ChevronDown
                                    className={`size-4 transition-transform ${
                                      isExpanded ? "rotate-180" : ""
                                    }`}
                                    aria-hidden="true"
                                  />
                                </button>
                              ) : null}
                            </section>
                          )
                        })}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.045] px-5 py-12 text-center">
              <p className="m-0 text-lg font-bold text-white">
                No languages found
              </p>
              <p className="m-0 mt-2 text-sm font-semibold text-stone-400">
                Try another search term.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
