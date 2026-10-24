"use client"

import Image, { type StaticImageData } from "next/image"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import React, { useEffect, useMemo, useRef, useState } from "react"
import regionAfricaImage from "../../../public/region-africa.png"
import regionAsiaImage from "../../../public/region-asia.png"
import regionEuropeImage from "../../../public/region-europe.png"
import regionNorthAmericaImage from "../../../public/region-north-america.png"
import regionOceaniaImage from "../../../public/region-oceania.png"
import regionSouthAmericaImage from "../../../public/region-south-america.png"
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Globe2,
  Languages,
  Search,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { normalizeCoverageLanguageSearchParams } from "./language-selection"
import {
  countryIdToCircleFlagUrl,
  resolveLanguageFlagCountryId,
} from "./language-flags"
import { apiFetch } from "@/lib/api-fetch"
import { cn } from "@/lib/utils"

type LanguageOption = {
  id: string
  englishLabel: string
  nativeLabel: string
}

type GeoContinent = {
  id: string
  name: string
}

type GeoCountry = {
  id: string
  name: string
  continentId: string
}

type GeoLanguage = {
  id: string
  englishLabel: string
  nativeLabel: string
  bcp47?: string | null
  iso3?: string | null
  countryIds: string[]
  continentIds: string[]
  countrySpeakers: Record<string, number>
}

export type GeoPayload = {
  continents: GeoContinent[]
  countries: GeoCountry[]
  languages: GeoLanguage[]
}

type MobilePickerTab = "regions" | "languages"

interface LanguageGeoSelectorProps {
  value: string[]
  options?: LanguageOption[]
  className?: string
  attentionRequired?: boolean
  attentionRequestKey?: number
  openRequestKey?: number
  onApplyLanguages?: (languageIds: string[]) => void
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function formatSpeakerPercentage(value: number, total: number): string {
  if (!Number.isFinite(value) || value <= 0) return ""
  if (!Number.isFinite(total) || total <= 0) return ""

  const percentage = (value / total) * 100
  const rounded =
    percentage >= 10
      ? percentage.toFixed(0)
      : percentage >= 1
        ? percentage.toFixed(1)
        : percentage.toFixed(2)

  const normalized = rounded
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1")

  return `${normalized}%`
}

function matchesLanguageQuery(language: GeoLanguage, query: string): boolean {
  const english = normalizeText(language.englishLabel)
  const native = normalizeText(language.nativeLabel)
  return english.includes(query) || native.includes(query)
}

const REGION_THEMES: Record<
  string,
  {
    accent: string
    bg: string
    border: string
    image: StaticImageData
    text: string
  }
> = {
  Africa: {
    accent: "#5f9f63",
    bg: "color-mix(in_srgb,#5f9f63_9%,var(--ds-panel))",
    border: "color-mix(in_srgb,#5f9f63_24%,var(--ds-line))",
    image: regionAfricaImage,
    text: "#2f7a35",
  },
  Asia: {
    accent: "#4f7fd3",
    bg: "color-mix(in_srgb,#4f7fd3_8%,var(--ds-panel))",
    border: "color-mix(in_srgb,#4f7fd3_23%,var(--ds-line))",
    image: regionAsiaImage,
    text: "#3267c6",
  },
  Europe: {
    accent: "#7d5bc8",
    bg: "color-mix(in_srgb,#7d5bc8_9%,var(--ds-panel))",
    border: "color-mix(in_srgb,#7d5bc8_24%,var(--ds-line))",
    image: regionEuropeImage,
    text: "#6d48be",
  },
  "North America": {
    accent: "#db8742",
    bg: "color-mix(in_srgb,#db8742_9%,var(--ds-panel))",
    border: "color-mix(in_srgb,#db8742_24%,var(--ds-line))",
    image: regionNorthAmericaImage,
    text: "#c9671b",
  },
  Oceania: {
    accent: "#3da2aa",
    bg: "color-mix(in_srgb,#3da2aa_9%,var(--ds-panel))",
    border: "color-mix(in_srgb,#3da2aa_24%,var(--ds-line))",
    image: regionOceaniaImage,
    text: "#13858f",
  },
  "South America": {
    accent: "#c6538d",
    bg: "color-mix(in_srgb,#c6538d_9%,var(--ds-panel))",
    border: "color-mix(in_srgb,#c6538d_24%,var(--ds-line))",
    image: regionSouthAmericaImage,
    text: "#b12f76",
  },
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

export function LanguageGeoSelector({
  value,
  options = [],
  className,
  attentionRequired = false,
  attentionRequestKey = 0,
  openRequestKey = 0,
  onApplyLanguages,
}: LanguageGeoSelectorProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [geoData, setGeoData] = useState<GeoPayload | null>(null)
  const [hasResolvedLanguageData, setHasResolvedLanguageData] = useState(
    options.length > 0,
  )
  const [remoteSearchData, setRemoteSearchData] = useState<GeoPayload | null>(
    null,
  )
  const [remoteSearchQuery, setRemoteSearchQuery] = useState("")
  const [searchValue, setSearchValue] = useState("")
  const [draftLanguages, setDraftLanguages] = useState<string[]>(value)
  const [draftContinents, setDraftContinents] = useState<Set<string>>(new Set())
  const [draftCountries, setDraftCountries] = useState<Set<string>>(new Set())
  const [isSearchingServer, setIsSearchingServer] = useState(false)
  const [isPickerExpanded, setIsPickerExpanded] = useState(false)
  const [mobilePickerTab, setMobilePickerTab] =
    useState<MobilePickerTab>("regions")
  const [pickerAvailableHeight, setPickerAvailableHeight] = useState<
    number | null
  >(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null)
  const primaryActionRef = useRef<HTMLButtonElement | null>(null)
  const selectedControlRef = useRef<HTMLDivElement | null>(null)
  const emptyControlRef = useRef<HTMLButtonElement | null>(null)
  const dropdownRef = useRef<HTMLDivElement | null>(null)
  const navigationTimeoutRef = useRef<number | null>(null)
  const inFlightSearchesRef = useRef(0)

  const selectedLanguageSet = useMemo(
    () => new Set(draftLanguages),
    [draftLanguages],
  )
  const languageLabelById = useMemo(() => {
    const labels = new Map<string, string>()

    for (const option of options) {
      const label = option.englishLabel.trim()
      if (label) {
        labels.set(option.id, label)
      }
    }

    for (const language of geoData?.languages ?? []) {
      const label = language.englishLabel.trim()
      if (label) {
        labels.set(language.id, label)
      }
    }

    for (const language of remoteSearchData?.languages ?? []) {
      const label = language.englishLabel.trim()
      if (label) {
        labels.set(language.id, label)
      }
    }

    return labels
  }, [geoData, options, remoteSearchData])
  const languageById = useMemo(() => {
    const languages = new Map<string, GeoLanguage>()

    for (const language of geoData?.languages ?? []) {
      languages.set(language.id, language)
    }

    for (const language of remoteSearchData?.languages ?? []) {
      languages.set(language.id, language)
    }

    return languages
  }, [geoData, remoteSearchData])
  const selectedLanguagePills = useMemo(
    () =>
      draftLanguages.map((id) => ({
        id,
        label: languageLabelById.get(id) ?? id,
      })),
    [draftLanguages, languageLabelById],
  )
  const selectedLanguageSummary = useMemo(() => {
    const [firstLanguage] = selectedLanguagePills
    if (!firstLanguage) {
      return {
        label: "Language",
        remainingCount: 0,
      }
    }

    return {
      label: firstLanguage.label,
      remainingCount: selectedLanguagePills.length - 1,
    }
  }, [selectedLanguagePills])
  const selectedLanguageFlagCountryIds = useMemo(
    () =>
      draftLanguages
        .map((id) => {
          const language = languageById.get(id)
          return language ? resolveLanguageFlagCountryId(language) : ""
        })
        .filter((countryId) => countryIdToCircleFlagUrl(countryId).length > 0)
        .filter(Boolean)
        .slice(0, 2),
    [draftLanguages, languageById],
  )

  useEffect(() => {
    if (typeof document === "undefined") return
    const loading = isLoading
    if (loading) {
      document.documentElement.dataset.coverageLoading = "true"
    } else {
      delete document.documentElement.dataset.coverageLoading
    }
  }, [isLoading])

  useEffect(() => {
    setIsLoading(false)
  }, [value])

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        window.clearTimeout(navigationTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let isActive = true
    const controller = new AbortController()

    const fetchLanguages = async () => {
      try {
        const response = await apiFetch("/api/languages", {
          signal: controller.signal,
        })

        if (!response.ok) return
        const payload = (await response.json()) as GeoPayload

        if (!isActive) return
        if (payload?.languages && payload?.countries && payload?.continents) {
          setGeoData(payload)
        }
      } catch {
        // keep fallback options
      } finally {
        if (isActive) {
          setHasResolvedLanguageData(true)
        }
      }
    }

    void fetchLanguages()

    return () => {
      isActive = false
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!geoData) return

    const query = normalizeText(searchValue)
    if (query.length < 2) {
      setRemoteSearchData(null)
      setRemoteSearchQuery("")
      setIsSearchingServer(false)
      return
    }

    const hasLocalMatch = geoData.languages.some((language) =>
      matchesLanguageQuery(language, query),
    )
    if (hasLocalMatch) {
      setRemoteSearchData(null)
      setRemoteSearchQuery(query)
      setIsSearchingServer(false)
      return
    }

    if (remoteSearchQuery === query) return

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        let didCompleteLookup = false

        try {
          inFlightSearchesRef.current += 1
          setIsSearchingServer(true)

          const response = await apiFetch(
            `/api/languages?search=${encodeURIComponent(query)}`,
            {
              signal: controller.signal,
            },
          )
          if (!response.ok) return
          didCompleteLookup = true

          const payload = (await response.json()) as GeoPayload
          if (payload?.languages?.length) {
            setRemoteSearchData(payload)
          } else {
            setRemoteSearchData(null)
          }
          setRemoteSearchQuery(query)
        } catch {
          // ignore fallback search errors
          setRemoteSearchData(null)
          setRemoteSearchQuery(query)
        } finally {
          if (!controller.signal.aborted && !didCompleteLookup) {
            setRemoteSearchQuery(query)
          }
          inFlightSearchesRef.current = Math.max(
            0,
            inFlightSearchesRef.current - 1,
          )
          if (inFlightSearchesRef.current === 0) {
            setIsSearchingServer(false)
          }
        }
      })()
    }, 300)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [geoData, remoteSearchQuery, searchValue])

  const countriesByContinent = useMemo(() => {
    if (!geoData) return []
    const continentMap = new Map(
      geoData.continents.map((continent) => [continent.id, continent]),
    )
    const grouped = new Map<string, GeoCountry[]>()
    for (const country of geoData.countries) {
      const bucket = grouped.get(country.continentId) ?? []
      bucket.push(country)
      grouped.set(country.continentId, bucket)
    }
    return Array.from(grouped.entries())
      .map(([continentId, countries]) => ({
        continent: continentMap.get(continentId),
        countries: [...countries].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((entry) => entry.continent != null)
      .sort((a, b) => a.continent!.name.localeCompare(b.continent!.name))
  }, [geoData])

  const selectedRegionSummary = useMemo(() => {
    const [selectedContinentId] = Array.from(draftContinents)
    if (!selectedContinentId) return null

    const selectedRegion = countriesByContinent.find(
      ({ continent }) => continent?.id === selectedContinentId,
    )
    if (!selectedRegion?.continent) return null

    return {
      count: selectedRegion.countries.length,
      label: selectedRegion.continent.name,
    }
  }, [countriesByContinent, draftContinents])

  const normalizedSearch = normalizeText(searchValue)

  const localSearchMatches = useMemo(() => {
    if (!geoData || !normalizedSearch) {
      return []
    }

    return geoData.languages.filter((language) =>
      matchesLanguageQuery(language, normalizedSearch),
    )
  }, [geoData, normalizedSearch])

  const usingRemoteSearchResults =
    normalizedSearch.length >= 2 &&
    localSearchMatches.length === 0 &&
    remoteSearchQuery === normalizedSearch

  const filteredLanguages = useMemo(() => {
    if (!geoData) return []

    const hasCountryFilter = draftCountries.size > 0
    const hasContinentFilter = draftContinents.size > 0
    const selectedCountryIds = Array.from(draftCountries)
    const matchesActiveGeoFilters = (language: GeoLanguage) => {
      if (
        hasContinentFilter &&
        !language.continentIds.some((id) => draftContinents.has(id))
      ) {
        return false
      }

      if (
        hasCountryFilter &&
        !language.countryIds.some((id) => draftCountries.has(id))
      ) {
        return false
      }

      return true
    }

    if (normalizedSearch) {
      const searchLanguages =
        localSearchMatches.length > 0
          ? localSearchMatches
          : usingRemoteSearchResults
            ? (remoteSearchData?.languages ?? [])
            : []

      return [...searchLanguages]
        .filter((language) => matchesLanguageQuery(language, normalizedSearch))
        .filter(matchesActiveGeoFilters)
        .sort((a, b) => a.englishLabel.localeCompare(b.englishLabel))
    }

    const getSpeakerCount = (language: GeoLanguage) => {
      if (!hasCountryFilter) return 0
      return selectedCountryIds.reduce(
        (sum, id) => sum + (language.countrySpeakers[id] ?? 0),
        0,
      )
    }

    return geoData.languages.filter(matchesActiveGeoFilters).sort((a, b) => {
      if (hasCountryFilter) {
        const speakerDiff = getSpeakerCount(b) - getSpeakerCount(a)
        if (speakerDiff !== 0) return speakerDiff
      }
      return a.englishLabel.localeCompare(b.englishLabel)
    })
  }, [
    draftContinents,
    draftCountries,
    geoData,
    localSearchMatches,
    normalizedSearch,
    remoteSearchData?.languages,
    usingRemoteSearchResults,
  ])

  const languageSpeakerEstimates = useMemo(() => {
    if (!geoData) return new Map<string, number>()

    if (usingRemoteSearchResults) {
      const estimates = new Map<string, number>()
      for (const language of filteredLanguages) {
        estimates.set(language.id, 0)
      }
      return estimates
    }

    const selectedCountryIds = Array.from(draftCountries)
    const hasCountryFilter = selectedCountryIds.length > 0
    const hasContinentFilter = draftContinents.size > 0
    const continentCountryIds = hasContinentFilter
      ? geoData.countries
          .filter((country) => draftContinents.has(country.continentId))
          .map((country) => country.id)
      : []
    const estimates = new Map<string, number>()

    for (const language of filteredLanguages) {
      const countryIds = hasCountryFilter
        ? selectedCountryIds
        : hasContinentFilter
          ? continentCountryIds
          : language.countryIds
      const totalSpeakers = countryIds.reduce(
        (sum, countryId) => sum + (language.countrySpeakers[countryId] ?? 0),
        0,
      )
      estimates.set(language.id, totalSpeakers)
    }

    return estimates
  }, [
    draftContinents,
    draftCountries,
    filteredLanguages,
    geoData,
    usingRemoteSearchResults,
  ])

  const visibleLanguages = useMemo(() => {
    const MIN_SPEAKERS_FOR_NON_ZERO_MIL = 100_000
    const MIN_VISIBLE_LANGUAGES = 5

    const languagesWithAtLeastPointOneMil = filteredLanguages.filter(
      (language) =>
        (languageSpeakerEstimates.get(language.id) ?? 0) >=
        MIN_SPEAKERS_FOR_NON_ZERO_MIL,
    )

    if (languagesWithAtLeastPointOneMil.length >= MIN_VISIBLE_LANGUAGES) {
      return languagesWithAtLeastPointOneMil
    }

    return filteredLanguages.slice(0, MIN_VISIBLE_LANGUAGES)
  }, [filteredLanguages, languageSpeakerEstimates])

  const hasSelectedCountry = draftCountries.size > 0

  const totalVisibleSpeakers = useMemo(
    () =>
      visibleLanguages.reduce(
        (sum, language) =>
          sum + (languageSpeakerEstimates.get(language.id) ?? 0),
        0,
      ),
    [visibleLanguages, languageSpeakerEstimates],
  )

  const applyUrlParams = React.useCallback(
    (nextLanguageIds: string[]) => {
      const currentQuery = searchParams?.toString() ?? ""
      const nextParams = normalizeCoverageLanguageSearchParams(
        currentQuery,
        nextLanguageIds,
      )

      const queryString = nextParams.toString()
      const nextUrl = queryString ? `${pathname}?${queryString}` : pathname
      const currentUrl = currentQuery ? `${pathname}?${currentQuery}` : pathname

      if (nextUrl === currentUrl) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      if (onApplyLanguages) {
        onApplyLanguages(nextLanguageIds)
        return
      }

      if (navigationTimeoutRef.current) {
        window.clearTimeout(navigationTimeoutRef.current)
      }
      navigationTimeoutRef.current = window.setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.push(nextUrl as any)
      }, 250)
    },
    [onApplyLanguages, pathname, router, searchParams],
  )

  const handleSelect = (nextValue: string) => {
    setDraftLanguages((prev) =>
      selectedLanguageSet.has(nextValue)
        ? prev.filter((id) => id !== nextValue)
        : [...prev, nextValue],
    )
  }

  const toggleContinent = (id: string) => {
    setDraftCountries(new Set())
    setDraftContinents((prev) => {
      if (prev.has(id)) {
        return new Set()
      }
      return new Set([id])
    })
  }

  const clearGeoFilters = () => {
    setDraftContinents(new Set())
    setDraftCountries(new Set())
    setSearchValue("")
  }

  const clearSearchValue = () => {
    setSearchValue("")
  }

  const confirmSelection = React.useCallback(() => {
    setIsPickerExpanded(false)
    applyUrlParams(draftLanguages)
  }, [applyUrlParams, draftLanguages])

  const scrollLanguageControlToTop = React.useCallback(() => {
    const control =
      selectedControlRef.current ??
      emptyControlRef.current ??
      primaryActionRef.current

    if (!control) return

    const topOffset = 40
    const scrollDelta = control.getBoundingClientRect().top - topOffset
    let scrollParent = control.parentElement

    while (scrollParent && scrollParent !== document.body) {
      const { overflowY } = window.getComputedStyle(scrollParent)
      if (
        /(auto|scroll|overlay)/.test(overflowY) &&
        scrollParent.scrollHeight > scrollParent.clientHeight
      ) {
        scrollParent.scrollBy({ top: scrollDelta, behavior: "auto" })
        return
      }

      scrollParent = scrollParent.parentElement
    }

    window.scrollBy({ top: scrollDelta, behavior: "auto" })
  }, [])

  const updatePickerAvailableHeight = React.useCallback(() => {
    if (!dropdownRef.current) return

    const { top } = dropdownRef.current.getBoundingClientRect()
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const nextHeight = Math.max(180, viewportHeight - top)

    setPickerAvailableHeight(nextHeight)
  }, [])

  const measurePickerHeightOnce = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      updatePickerAvailableHeight()
    })
  }, [updatePickerAvailableHeight])

  const handlePrimaryAction = React.useCallback(() => {
    if (isPickerExpanded) {
      confirmSelection()
      return
    }

    setMobilePickerTab("regions")
    setIsPickerExpanded(true)
    window.requestAnimationFrame(() => {
      scrollLanguageControlToTop()
      if (window.matchMedia("(min-width: 768px)").matches) {
        searchInputRef.current?.focus({ preventScroll: true })
      }
      measurePickerHeightOnce()
    })
  }, [
    confirmSelection,
    isPickerExpanded,
    measurePickerHeightOnce,
    scrollLanguageControlToTop,
  ])

  const clearSelectedLanguages = React.useCallback(() => {
    setDraftLanguages([])
    applyUrlParams([])
  }, [applyUrlParams])

  useEffect(() => {
    if (!isPickerExpanded) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        !target ||
        selectedControlRef.current?.contains(target) ||
        emptyControlRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return
      }

      confirmSelection()
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
    }
  }, [confirmSelection, isPickerExpanded])

  useEffect(() => {
    if (!isPickerExpanded) {
      setPickerAvailableHeight(null)
    }
  }, [isPickerExpanded])

  useEffect(() => {
    setDraftLanguages(value)
  }, [value])

  useEffect(() => {
    if (attentionRequired && attentionRequestKey > 0) {
      window.requestAnimationFrame(() => {
        if (isPickerExpanded) {
          searchInputRef.current?.focus()
          return
        }

        primaryActionRef.current?.focus()
      })
    }
  }, [attentionRequired, attentionRequestKey, isPickerExpanded])

  useEffect(() => {
    if (openRequestKey <= 0) return

    setMobilePickerTab("regions")
    setIsPickerExpanded(true)
    window.requestAnimationFrame(() => {
      scrollLanguageControlToTop()
      if (window.matchMedia("(min-width: 768px)").matches) {
        searchInputRef.current?.focus({ preventScroll: true })
      }
      measurePickerHeightOnce()
    })
  }, [measurePickerHeightOnce, openRequestKey, scrollLanguageControlToTop])

  const shouldShowSelector = options.length > 0 || hasResolvedLanguageData

  if (!shouldShowSelector) {
    return null
  }

  const renderLanguageBrowser = (
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) => (
    <div className="flex min-h-0 w-full max-w-[24rem] min-w-0 flex-1 flex-col overflow-hidden md:max-w-none">
      <div className="relative shrink-0">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--ds-muted)]"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={searchValue}
          ref={inputRef}
          onFocus={() => setIsPickerExpanded(true)}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="Search languages..."
          aria-label="Search languages"
          className="h-11 rounded-xl border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] px-10 text-sm font-medium text-[color:var(--ds-ink)] shadow-none ring-0 transition-colors duration-75 placeholder:text-[color:var(--ds-soft)] focus:!border-[color:var(--ds-black)] focus:!shadow-none focus:!outline-none focus:!ring-0 focus-visible:!border-[color:var(--ds-black)] focus-visible:!shadow-none focus-visible:!ring-0 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
        />
        {searchValue ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 size-7 -translate-y-1/2 rounded-lg border-0 bg-transparent text-[color:var(--ds-muted)] shadow-none transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] hover:text-[color:var(--ds-ink)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_10%,transparent)] focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]"
            onClick={clearSearchValue}
            aria-label="Clear search"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {isSearchingServer && (
        <span
          className="mt-2 shrink-0 text-xs font-medium text-[color:var(--ds-muted)]"
          aria-live="polite"
        >
          Searching server...
        </span>
      )}
      <button
        type="button"
        className={cn(
          "mt-4 flex h-11 w-full shrink-0 cursor-pointer select-none items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-[color:var(--ds-ink)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]",
          draftContinents.size === 0 &&
            draftCountries.size === 0 &&
            "bg-[color:color-mix(in_srgb,var(--ds-black)_4%,transparent)]",
        )}
        onClick={clearGeoFilters}
        aria-pressed={draftContinents.size === 0 && draftCountries.size === 0}
      >
        <Globe2
          className="size-4 shrink-0 text-[color:var(--ds-muted)]"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">All Languages</span>
        <span className="shrink-0 rounded-full border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] px-2 py-0.5 text-xs font-semibold text-[color:var(--ds-muted)]">
          {formatCompactCount(geoData?.languages.length ?? options.length)}
        </span>
      </button>
      {selectedRegionSummary ? (
        <div className="mt-3 flex w-full shrink-0 items-center justify-between gap-3 px-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--ds-muted)]">
          <span className="flex min-w-0 items-center gap-3">
            <ChevronDown
              className="size-4 shrink-0 text-[color:var(--ds-muted)]"
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">
              {selectedRegionSummary.label}
            </span>
          </span>
          <span className="shrink-0 rounded-full border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] px-2 py-0.5 text-xs font-semibold tracking-normal text-[color:var(--ds-muted)]">
            {formatCompactCount(selectedRegionSummary.count)}
          </span>
        </div>
      ) : null}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-1">
          {visibleLanguages.map((language) => {
            const speakerEstimate =
              languageSpeakerEstimates.get(language.id) ?? 0
            const speakerLabel = hasSelectedCountry
              ? formatSpeakerPercentage(speakerEstimate, totalVisibleSpeakers)
              : ""
            const isSelected = selectedLanguageSet.has(language.id)
            const flagCountryId = resolveLanguageFlagCountryId(language)
            const flagUrl = countryIdToCircleFlagUrl(flagCountryId)
            const nativeLabel =
              language.nativeLabel.trim() || language.englishLabel

            return (
              <label
                key={language.id}
                className={cn(
                  "group flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium text-[color:var(--ds-ink)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)] focus-within:bg-[color:color-mix(in_srgb,var(--ds-black)_5%,transparent)]",
                  isSelected &&
                    "bg-[color:color-mix(in_srgb,var(--ds-black)_4%,transparent)]",
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleSelect(language.id)}
                  className="sr-only"
                />
                {flagUrl ? (
                  <span
                    className="size-4 shrink-0 rounded-full bg-cover bg-center bg-no-repeat"
                    style={{ backgroundImage: `url(${flagUrl})` }}
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className="size-4 shrink-0 rounded-full border border-[color:var(--ds-line)]"
                    aria-hidden="true"
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="block min-w-0 truncate">
                      {language.englishLabel}
                    </span>
                    {speakerLabel ? (
                      <span className="shrink-0 text-xs font-semibold text-[color:var(--ds-muted)]">
                        {speakerLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block min-w-0 truncate text-xs font-medium leading-tight text-[color:var(--ds-muted)]">
                    {nativeLabel}
                  </span>
                </span>
                <ArrowRight
                  className="size-3.5 shrink-0 text-[color:var(--ds-soft)] opacity-0 transition-opacity duration-75 group-hover:opacity-100 group-focus-within:opacity-100"
                  aria-hidden="true"
                />
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )

  const renderRegionTile = (
    continent: GeoContinent,
    countries: GeoCountry[],
    mode: "desktop" | "mobile",
  ) => {
    const theme = REGION_THEMES[continent.name]
    const isActive =
      draftContinents.has(continent.id) ||
      countries.some((country) => draftCountries.has(country.id))

    return (
      <button
        key={continent.id}
        type="button"
        className={cn(
          "group relative flex aspect-[724/543] cursor-pointer select-none flex-col overflow-hidden border text-left shadow-[0_1px_0_rgba(17,17,17,0.03)] transition-all duration-100 hover:-translate-y-px hover:shadow-[0_10px_28px_rgba(17,17,17,0.08)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]",
          mode === "mobile" ? "rounded-lg" : "rounded-xl",
        )}
        style={{
          background: isActive
            ? `color-mix(in_srgb,${theme.accent}_14%,var(--ds-panel))`
            : theme.bg,
          borderColor: isActive
            ? `color-mix(in_srgb,${theme.accent}_58%,var(--ds-line))`
            : "var(--ds-line)",
        }}
        aria-pressed={isActive}
        onClick={() => {
          toggleContinent(continent.id)
          if (mode === "mobile") {
            setMobilePickerTab("languages")
          }
        }}
      >
        <span className="absolute inset-0 overflow-hidden">
          <Image
            src={theme.image}
            alt=""
            fill
            loading="eager"
            sizes="(max-width: 767px) calc((100vw - 5.5rem) / 2), (max-width: 900px) 18rem, 22vw"
            className="object-cover transition-transform duration-200 group-hover:scale-[1.025]"
          />
        </span>
        <span
          className={cn(
            "absolute inset-0 transition-opacity duration-100",
            isActive
              ? "bg-[color:color-mix(in_srgb,var(--ds-black)_0%,transparent)] opacity-0"
              : "bg-[color:color-mix(in_srgb,var(--ds-panel)_24%,transparent)] opacity-20 group-hover:opacity-0",
          )}
        />
        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 via-black/24 to-transparent" />
        <span
          className={cn(
            "relative z-[1] mt-auto flex min-w-0 items-center",
            mode === "mobile"
              ? "gap-1.5 px-2 pb-2 pt-2"
              : "gap-3 px-3 pb-3 pt-2.5",
          )}
        >
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate font-bold leading-tight text-white [text-shadow:0_2px_10px_rgba(17,17,17,0.38)]",
                mode === "mobile" ? "text-sm" : "text-xl",
              )}
            >
              {continent.name}
            </span>
            <span
              className={cn(
                "block truncate font-bold leading-tight text-white [text-shadow:0_2px_10px_rgba(17,17,17,0.38)]",
                mode === "mobile" ? "mt-0.5 text-[0.68rem]" : "mt-1 text-base",
              )}
            >
              {formatCompactCount(countries.length)} languages
            </span>
          </span>
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full border border-[color:var(--ds-line)] bg-[color:color-mix(in_srgb,var(--ds-panel)_90%,transparent)] text-[color:var(--ds-ink)] shadow-[0_4px_14px_rgba(17,17,17,0.12)] transition-transform duration-75 group-hover:translate-x-0.5",
              mode === "mobile" ? "size-6" : "size-8",
            )}
            style={{ color: theme.text }}
          >
            <ArrowRight
              className={mode === "mobile" ? "size-3.5" : "size-4"}
              aria-hidden="true"
            />
          </span>
        </span>
      </button>
    )
  }

  return (
    <div
      className={[
        "geo-panel",
        attentionRequired ? "geo-panel--attention" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="geo-selected geo-selected--external">
        <div className="geo-selected-actions">
          {selectedLanguagePills.length > 0 ? (
            <div
              ref={selectedControlRef}
              className={cn(
                "flex h-10 max-w-full cursor-pointer select-none items-center rounded-xl border border-[color:var(--ds-black)] bg-[color:color-mix(in_srgb,var(--ds-black)_3%,transparent)] px-3 text-sm font-medium text-[color:var(--ds-ink)] ring-[0.5px] ring-[color:var(--ds-black)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)]",
                isPickerExpanded &&
                  "bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)]",
              )}
            >
              <button
                type="button"
                className="relative -ml-0.5 mr-0.5 inline-flex h-7 w-7 shrink-0 -translate-x-1 items-center justify-center rounded-lg bg-transparent p-0 text-[color:var(--ds-muted)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] hover:text-[color:var(--ds-ink)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_10%,transparent)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)] disabled:pointer-events-auto disabled:text-[color:var(--ds-soft)]"
                onClick={clearSelectedLanguages}
                disabled={isLoading}
                aria-label="Clear selected languages"
              >
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-inherit focus-visible:outline-none"
                ref={primaryActionRef}
                onClick={handlePrimaryAction}
                disabled={isLoading}
                aria-describedby={
                  attentionRequired
                    ? "translation-language-required-hint"
                    : undefined
                }
              >
                {selectedLanguageFlagCountryIds.length > 0 ? (
                  <span
                    className="flex shrink-0 -translate-x-[3px] items-center mr-[3px]"
                    aria-hidden="true"
                  >
                    {selectedLanguageFlagCountryIds.map((countryId, index) => (
                      <span
                        key={`${countryId}-${index}`}
                        className="relative h-[18px] w-[18px] shrink-0 rounded-full bg-cover bg-center bg-no-repeat ring-2 ring-[color:var(--ds-bg)]"
                        style={{
                          backgroundImage: `url(${countryIdToCircleFlagUrl(countryId)})`,
                          marginLeft: index === 0 ? 0 : -4,
                          zIndex: selectedLanguageFlagCountryIds.length - index,
                        }}
                      />
                    ))}
                  </span>
                ) : null}
                <span className="flex h-full min-w-0 items-center overflow-hidden">
                  <span className="block min-w-0 truncate">
                    <bdi>{selectedLanguageSummary.label}</bdi>
                    {selectedLanguageSummary.remainingCount > 0 ? (
                      <span dir="ltr">
                        {" "}
                        &amp; {selectedLanguageSummary.remainingCount} more
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={cn(
                "flex h-10 max-w-full cursor-pointer select-none items-center rounded-xl border border-[color:color-mix(in_srgb,var(--ds-black)_14%,transparent)] bg-transparent px-3 text-sm font-medium text-[color:var(--ds-muted)] transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_6%,transparent)] active:bg-[color:color-mix(in_srgb,var(--ds-black)_10%,transparent)] focus-visible:border-[color:var(--ds-black)] focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]",
                isPickerExpanded &&
                  "border-[color:var(--ds-black)] bg-[color:color-mix(in_srgb,var(--ds-black)_3%,transparent)] text-[color:var(--ds-ink)] ring-[0.5px] ring-[color:var(--ds-black)]",
              )}
              ref={(node) => {
                primaryActionRef.current = node
                emptyControlRef.current = node
              }}
              onClick={handlePrimaryAction}
              disabled={isLoading}
              aria-describedby={
                attentionRequired
                  ? "translation-language-required-hint"
                  : undefined
              }
            >
              <span className="flex shrink-0 items-center gap-1.5">
                <Languages className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>Language</span>
              </span>
              {isPickerExpanded ? (
                <ChevronUp
                  className="ml-1 h-4 w-4 shrink-0 opacity-50"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="ml-1 h-4 w-4 shrink-0 opacity-50"
                  aria-hidden="true"
                />
              )}
            </button>
          )}
        </div>
        {attentionRequired ? (
          <p
            id="translation-language-required-hint"
            className="geo-attention-hint"
          >
            Select at least one language to enable enrichment.
          </p>
        ) : null}
      </div>
      {isPickerExpanded && (
        <div
          className="flex w-[calc(100vw-2.5rem)] max-w-[calc(100vw-2.5rem)] min-w-0 flex-col overflow-hidden rounded-[calc(var(--ds-radius)+6px)] border border-[color:var(--ds-line)] bg-[color:var(--ds-panel)] shadow-[0_24px_62px_rgba(17,17,17,0.13)] md:w-full"
          style={{
            height: pickerAvailableHeight
              ? `${pickerAvailableHeight}px`
              : "calc(100dvh - 6rem)",
          }}
          role="group"
          aria-label="Language"
          ref={dropdownRef}
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[color:var(--ds-line)] px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--ds-black)_4%,transparent)] text-[color:var(--ds-muted)]">
                <Globe2 className="size-6" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-base font-semibold leading-tight text-[color:var(--ds-ink)]">
                  Choose a language
                </p>
                <p className="m-0 mt-1 text-xs font-medium leading-tight text-[color:var(--ds-muted)]">
                  Explore languages by region or browse the full list.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="sticky right-3 z-10 size-9 shrink-0 rounded-full border border-[color:var(--ds-line)] bg-[color:color-mix(in_srgb,var(--ds-black)_3%,var(--ds-panel))] text-[color:var(--ds-ink)] shadow-none transition-colors duration-75 hover:bg-[color:color-mix(in_srgb,var(--ds-black)_7%,transparent)] focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]"
              onClick={confirmSelection}
              aria-label="Close language picker"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="flex h-full min-w-0 flex-col md:hidden">
              <div className="shrink-0 border-b border-[color:var(--ds-line)] px-4 py-3">
                <div
                  className="grid h-10 rounded-xl bg-[color:color-mix(in_srgb,var(--ds-black)_4%,transparent)] p-1"
                  role="tablist"
                  aria-label="Language picker sections"
                >
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mobilePickerTab === "regions"}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-lg text-sm font-semibold text-[color:var(--ds-muted)] transition-colors duration-75 focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]",
                        mobilePickerTab === "regions" &&
                          "bg-[color:var(--ds-panel)] text-[color:var(--ds-ink)] shadow-[0_1px_2px_rgba(17,17,17,0.06)]",
                      )}
                      onClick={() => setMobilePickerTab("regions")}
                    >
                      Regions
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mobilePickerTab === "languages"}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-lg text-sm font-semibold text-[color:var(--ds-muted)] transition-colors duration-75 focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-[color:var(--ds-black)]",
                        mobilePickerTab === "languages" &&
                          "bg-[color:var(--ds-panel)] text-[color:var(--ds-ink)] shadow-[0_1px_2px_rgba(17,17,17,0.06)]",
                      )}
                      onClick={() => setMobilePickerTab("languages")}
                    >
                      Languages
                    </button>
                  </div>
                </div>
              </div>
              {mobilePickerTab === "regions" ? (
                <div
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  role="tabpanel"
                  aria-label="Regions"
                >
                  <div className="grid grid-cols-2 gap-2">
                    {countriesByContinent.map(({ continent, countries }) =>
                      continent
                        ? renderRegionTile(continent, countries, "mobile")
                        : null,
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className="flex min-h-0 flex-1 overflow-hidden px-4 py-4"
                  role="tabpanel"
                  aria-label="Languages"
                >
                  {renderLanguageBrowser(mobileSearchInputRef)}
                </div>
              )}
            </div>
            <div className="hidden h-full min-w-[54rem] grid-cols-[17rem_minmax(34rem,1fr)] overflow-x-auto md:grid md:min-w-0">
              <div className="flex min-h-0 min-w-0 flex-col border-r border-[color:var(--ds-line)] px-4 py-4">
                {renderLanguageBrowser(searchInputRef)}
              </div>
              <div className="flex min-h-0 min-w-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <p className="m-0 mb-4 text-sm font-semibold text-[color:var(--ds-ink)]">
                    Browse by region
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {countriesByContinent.map(({ continent, countries }) =>
                      continent
                        ? renderRegionTile(continent, countries, "desktop")
                        : null,
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
