"use client"

import Link from "next/link"
import type { Route } from "next"
import { ArrowRight, ChevronDown, Globe2, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

import type {
  WatchLanguageIndexCountryGroup,
  WatchLanguageIndexLanguage,
  WatchLanguageIndexRegion,
} from "@/lib/language-index"
import { CONTENT_WIDTH_ALIGN_CLASSES } from "@/lib/content-width"

type WatchLanguageIndexBrowserProps = {
  regions: WatchLanguageIndexRegion[]
}

type RegionArtwork = {
  image: string
}

type FilteredCountrySearchResult = {
  country: WatchLanguageIndexCountryGroup
  countryIndex: number
  countryMatchRank: number
  matchingLanguageSpeakerCount: number
}

type FilteredRegionSearchResult = WatchLanguageIndexRegion & {
  regionIndex: number
  searchCountryMatchRank: number
  searchLanguageSpeakerCount: number
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

function countryMatchRank(
  country: WatchLanguageIndexCountryGroup,
  query: string,
): number {
  if (!query) return 0
  const countryName = normalizeText(country.name)
  if (countryName === query) return 3
  if (countryName.startsWith(query)) return 2
  if (countryName.includes(query)) return 1
  return 0
}

function matchingLanguageSpeakerCount(
  country: WatchLanguageIndexCountryGroup,
  query: string,
): number {
  if (!query) return 0
  return country.languages
    .filter((language) => languageMatchesQuery(language, query))
    .reduce(
      (total, language) =>
        total + (country.languageSpeakerCounts[language.publicSlug] ?? 0),
      0,
    )
}

function compareFilteredCountrySearchResults(
  a: FilteredCountrySearchResult,
  b: FilteredCountrySearchResult,
): number {
  return (
    b.countryMatchRank - a.countryMatchRank ||
    b.matchingLanguageSpeakerCount - a.matchingLanguageSpeakerCount ||
    b.country.speakerCount - a.country.speakerCount ||
    a.country.name.localeCompare(b.country.name) ||
    a.countryIndex - b.countryIndex
  )
}

function compareFilteredRegionSearchResults(
  a: FilteredRegionSearchResult,
  b: FilteredRegionSearchResult,
): number {
  return (
    b.searchCountryMatchRank - a.searchCountryMatchRank ||
    b.searchLanguageSpeakerCount - a.searchLanguageSpeakerCount ||
    a.name.localeCompare(b.name) ||
    a.regionIndex - b.regionIndex
  )
}

function countryKey(
  regionName: string,
  country: WatchLanguageIndexCountryGroup,
) {
  return `${regionName}:${country.id}`
}

function safeDomId(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-")
}

function LanguageLink({ language }: { language: WatchLanguageIndexLanguage }) {
  return (
    <li>
      <Link
        href={language.href as Route}
        className="group flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 text-left text-stone-100 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base leading-tight font-medium">
            {language.englishLabel}
          </span>
          <span className="mt-1 block truncate text-sm leading-tight font-normal text-stone-500">
            {language.nativeLabel}
          </span>
        </span>
        <ArrowRight
          className="size-4 shrink-0 text-amber-200 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}

function CountryLanguages({
  country,
  expanded,
  onToggle,
  regionName,
}: {
  country: WatchLanguageIndexCountryGroup
  expanded: boolean
  onToggle: () => void
  regionName: string
}) {
  const hiddenLanguageCount = Math.max(
    0,
    country.languages.length - COUNTRY_LANGUAGE_PREVIEW_COUNT,
  )
  const visibleLanguages = expanded
    ? country.languages
    : country.languages.slice(0, COUNTRY_LANGUAGE_PREVIEW_COUNT)
  const extraLanguagesId = `country-languages-${safeDomId(
    countryKey(regionName, country),
  )}`

  return (
    <section
      className="border-t border-white/10 py-5 first:border-t-0 first:pt-0"
      aria-label={`${country.name} languages`}
    >
      <header className="mb-3 flex items-center gap-3">
        {country.flagPngSrc ? (
          <span
            className="size-8 shrink-0 rounded-full bg-cover bg-center bg-no-repeat ring-1 ring-white/25"
            style={{ backgroundImage: `url(${country.flagPngSrc})` }}
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
        <div className="min-w-0">
          <h4 className="m-0 truncate text-lg leading-tight font-bold text-white">
            {country.name}
          </h4>
          <p className="m-0 mt-0.5 text-sm leading-tight font-semibold text-stone-400">
            {formatLanguageCount(country.languages.length)}
          </p>
        </div>
      </header>

      <ul
        id={hiddenLanguageCount > 0 ? extraLanguagesId : undefined}
        className="m-0 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2 xl:grid-cols-3"
      >
        {visibleLanguages.map((language) => (
          <LanguageLink
            key={`${country.id}-${language.publicSlug}`}
            language={language}
          />
        ))}
      </ul>

      {hiddenLanguageCount > 0 ? (
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-medium text-amber-100 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
          aria-controls={extraLanguagesId}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded
            ? "Show less"
            : `Show ${formatCount(hiddenLanguageCount)} more`}
          <ChevronDown
            className={`size-4 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>
      ) : null}
    </section>
  )
}

function RegionLanguages({
  expandedCountryKeys,
  onToggleCountry,
  region,
}: {
  expandedCountryKeys: ReadonlySet<string>
  onToggleCountry: (key: string) => void
  region: WatchLanguageIndexRegion
}) {
  const artwork = REGION_ARTWORK[region.name] ?? FALLBACK_REGION_ARTWORK

  return (
    <section className="grid gap-6 border-t border-white/10 py-8 lg:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)] lg:items-start">
      <header className="beveled relative min-h-48 overflow-hidden rounded-xl bg-black lg:min-h-[24rem]">
        <span
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-90 saturate-125"
          style={{ backgroundImage: `url(${artwork.image})` }}
          aria-hidden="true"
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
        <span className="absolute inset-0 bg-[url(/watch/images/overlay.svg)] bg-repeat opacity-25 mix-blend-soft-light" />
        <span className="relative z-[1] flex h-full min-h-48 flex-col justify-end p-5 lg:min-h-[24rem]">
          <span className="mb-3 w-fit rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold tracking-[0.2em] text-amber-200 uppercase backdrop-blur-sm">
            Region
          </span>
          <h3 className="m-0 text-3xl leading-none font-bold text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]">
            {region.name}
          </h3>
          <span className="mt-2 text-lg leading-none font-bold text-stone-200 [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]">
            {formatLanguageCount(region.languages.length)}
          </span>
        </span>
      </header>

      <div className="min-w-0">
        {region.countries.map((country) => {
          const key = countryKey(region.name, country)
          return (
            <CountryLanguages
              key={key}
              country={country}
              expanded={expandedCountryKeys.has(key)}
              onToggle={() => onToggleCountry(key)}
              regionName={region.name}
            />
          )
        })}
      </div>
    </section>
  )
}

export function WatchLanguageIndexBrowser({
  regions,
}: WatchLanguageIndexBrowserProps) {
  const [searchValue, setSearchValue] = useState("")
  const [expandedCountryKeys, setExpandedCountryKeys] = useState<
    ReadonlySet<string>
  >(new Set())

  const normalizedSearch = normalizeText(searchValue)
  const regionGroups = useMemo(() => {
    const nextRegions = regions
      .map((region, regionIndex): FilteredRegionSearchResult => {
        const countryResults = region.countries
          .map((country, countryIndex): FilteredCountrySearchResult => {
            const countryRank = countryMatchRank(country, normalizedSearch)
            const matchingLanguages = country.languages.filter((language) =>
              languageMatchesQuery(language, normalizedSearch),
            )
            const visibleLanguages =
              countryRank > 0 ? country.languages : matchingLanguages

            return {
              country: {
                ...country,
                languages: visibleLanguages,
              },
              countryIndex,
              countryMatchRank: countryRank,
              matchingLanguageSpeakerCount: matchingLanguageSpeakerCount(
                country,
                normalizedSearch,
              ),
            }
          })
          .filter((result) => result.country.languages.length > 0)

        if (normalizedSearch) {
          countryResults.sort(compareFilteredCountrySearchResults)
        }

        const countries = countryResults.map((result) => result.country)
        const languageSlugs = new Set(
          countries.flatMap((country) =>
            country.languages.map((language) => language.publicSlug),
          ),
        )

        return {
          ...region,
          countries,
          languages: region.languages.filter((language) =>
            languageSlugs.has(language.publicSlug),
          ),
          regionIndex,
          searchCountryMatchRank: countryResults[0]?.countryMatchRank ?? 0,
          searchLanguageSpeakerCount:
            countryResults[0]?.matchingLanguageSpeakerCount ?? 0,
        }
      })
      .filter((region) => region.countries.length > 0)

    if (normalizedSearch) {
      nextRegions.sort(compareFilteredRegionSearchResults)
    }

    return nextRegions
  }, [normalizedSearch, regions])
  const visibleLanguageCount = useMemo(
    () =>
      new Set(
        regionGroups.flatMap((region) =>
          region.languages.map((language) => language.publicSlug),
        ),
      ).size,
    [regionGroups],
  )
  const toggleCountryExpansion = (key: string) => {
    setExpandedCountryKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys)
      if (nextKeys.has(key)) nextKeys.delete(key)
      else nextKeys.add(key)
      return nextKeys
    })
  }

  return (
    <section
      className={`${CONTENT_WIDTH_ALIGN_CLASSES} relative font-sans text-stone-100`}
      aria-labelledby="language-index-title"
    >
      <header className="mb-6 flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-amber-200 ring-1 ring-white/15">
          <Globe2 className="size-6" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="mb-1 block text-xs font-bold tracking-[0.24em] text-red-100/70 uppercase">
            Watch languages
          </span>
          <h1
            id="language-index-title"
            className="m-0 text-2xl leading-tight font-bold tracking-normal text-white sm:text-3xl"
          >
            Choose a language
          </h1>
          <span className="mt-1 block text-sm leading-tight font-semibold text-stone-300/80 sm:text-base">
            Explore languages by region or browse the full list.
          </span>
        </span>
      </header>

      <label className="relative mb-8 block w-full max-w-3xl">
        <Search
          className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-white/70"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search languages or countries..."
          aria-label="Search languages or countries"
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
      </label>

      <p className="m-0 text-xs font-bold tracking-[0.24em] text-red-100/70 uppercase">
        Browse
      </p>
      <h2 className="m-0 mt-1 text-xl leading-tight font-bold text-white sm:text-2xl">
        Browse by region and country
      </h2>
      <p
        className="m-0 mt-2 text-sm font-bold text-stone-400"
        aria-live="polite"
      >
        {formatCount(visibleLanguageCount)} languages
      </p>

      {regionGroups.length > 0 ? (
        regionGroups.map((region) => (
          <RegionLanguages
            key={region.name}
            expandedCountryKeys={expandedCountryKeys}
            onToggleCountry={toggleCountryExpansion}
            region={region}
          />
        ))
      ) : (
        <section className="border-t border-white/10 py-12 text-center">
          <h3 className="m-0 text-lg font-bold text-white">
            No languages found
          </h3>
          <p className="m-0 mt-2 text-sm font-semibold text-stone-400">
            Try another search term.
          </p>
        </section>
      )}
    </section>
  )
}
