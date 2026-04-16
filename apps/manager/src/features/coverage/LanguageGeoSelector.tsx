"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { Languages, XCircle } from "lucide-react"
import { normalizeCoverageLanguageSearchParams } from "./language-selection"
import { apiFetch } from "@/lib/api-fetch"

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
  countryIds: string[]
  continentIds: string[]
  countrySpeakers: Record<string, number>
}

export type GeoPayload = {
  continents: GeoContinent[]
  countries: GeoCountry[]
  languages: GeoLanguage[]
}

interface LanguageGeoSelectorProps {
  value: string[]
  options?: LanguageOption[]
  className?: string
  attentionRequired?: boolean
  attentionRequestKey?: number
  openRequestKey?: number
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function countryIdToFlagEmoji(countryId: string): string {
  const normalized = countryId.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) return ""

  const first = normalized.codePointAt(0)
  const second = normalized.codePointAt(1)
  if (first == null || second == null) return ""

  const regionalIndicatorOffset = 0x1f1a5
  return String.fromCodePoint(
    first + regionalIndicatorOffset,
    second + regionalIndicatorOffset,
  )
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

export function LanguageGeoSelector({
  value,
  options = [],
  className,
  attentionRequired = false,
  attentionRequestKey = 0,
  openRequestKey = 0,
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
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const primaryActionRef = useRef<HTMLButtonElement | null>(null)
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
  const selectedLanguagePills = useMemo(
    () =>
      draftLanguages.map((id) => ({
        id,
        label: languageLabelById.get(id) ?? id,
      })),
    [draftLanguages, languageLabelById],
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
    const selectedCountryIds = Array.from(draftCountries)

    if (normalizedSearch) {
      const searchLanguages =
        localSearchMatches.length > 0
          ? localSearchMatches
          : usingRemoteSearchResults
            ? (remoteSearchData?.languages ?? [])
            : []

      return [...searchLanguages]
        .filter((language) => matchesLanguageQuery(language, normalizedSearch))
        .sort((a, b) => a.englishLabel.localeCompare(b.englishLabel))
    }

    const getSpeakerCount = (language: GeoLanguage) => {
      if (!hasCountryFilter) return 0
      return selectedCountryIds.reduce(
        (sum, id) => sum + (language.countrySpeakers[id] ?? 0),
        0,
      )
    }

    return geoData.languages
      .filter((language) => {
        if (
          draftContinents.size > 0 &&
          !language.continentIds.some((id) => draftContinents.has(id))
        ) {
          return false
        }
        if (
          draftCountries.size > 0 &&
          !language.countryIds.some((id) => draftCountries.has(id))
        ) {
          return false
        }
        return true
      })
      .sort((a, b) => {
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

  const applyUrlParams = (nextLanguageIds: string[]) => {
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
    if (navigationTimeoutRef.current) {
      window.clearTimeout(navigationTimeoutRef.current)
    }
    navigationTimeoutRef.current = window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push(nextUrl as any)
    }, 250)
  }

  const handleSelect = (nextValue: string) => {
    setDraftLanguages((prev) =>
      selectedLanguageSet.has(nextValue)
        ? prev.filter((id) => id !== nextValue)
        : [...prev, nextValue],
    )
  }

  const toggleContinent = (id: string) => {
    setDraftContinents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleCountry = (id: string) => {
    setDraftCountries((prev) => {
      if (prev.has(id)) {
        return new Set()
      }
      return new Set([id])
    })
  }

  const clearFilters = () => {
    setDraftContinents(new Set())
    setDraftCountries(new Set())
    setDraftLanguages([])
    setSearchValue("")
  }

  const confirmSelection = () => {
    setIsPickerExpanded(false)
    applyUrlParams(draftLanguages)
  }

  const handlePrimaryAction = () => {
    if (isPickerExpanded) {
      confirmSelection()
      return
    }

    setIsPickerExpanded(true)
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }

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

    setIsPickerExpanded(true)
    window.requestAnimationFrame(() => {
      primaryActionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
      searchInputRef.current?.focus()
    })
  }, [openRequestKey])

  const availableLanguageCount =
    options.length > 0 ? options.length : (geoData?.languages.length ?? 0)
  const shouldShowSelector = options.length > 0 || hasResolvedLanguageData

  if (!shouldShowSelector) {
    return null
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
        <p className="geo-selected-title">Selected languages</p>
        <div
          className={`geo-selected-actions${
            selectedLanguagePills.length > 0 ? " has-pills" : ""
          }`}
        >
          {selectedLanguagePills.length > 0 ? (
            <div className="geo-selected-pills">
              {selectedLanguagePills.map((language) => (
                <button
                  key={language.id}
                  type="button"
                  className="geo-selected-pill"
                  onClick={() => {
                    const next = draftLanguages.filter(
                      (id) => id !== language.id,
                    )
                    setDraftLanguages(next)
                    applyUrlParams(next)
                  }}
                  aria-label={`Remove ${language.label}`}
                >
                  {language.label}
                  <span className="geo-selected-pill-remove" aria-hidden="true">
                    x
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <span className="geo-selected-count">
              {availableLanguageCount > 0 ? availableLanguageCount : "…"}{" "}
              languages available
            </span>
          )}
          <button
            type="button"
            className="geo-confirm"
            ref={primaryActionRef}
            onClick={handlePrimaryAction}
            disabled={isLoading}
            aria-describedby={
              attentionRequired
                ? "translation-language-required-hint"
                : undefined
            }
          >
            {isPickerExpanded ? "Confirm" : "Select languages"}
          </button>
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
        <div className="geo-dropdown" role="group" aria-label="Language">
          <div className="geo-toolbar">
            <div className="geo-search-shell">
              <Languages className="geo-search-icon" aria-hidden="true" />
              <input
                type="search"
                value={searchValue}
                ref={searchInputRef}
                onFocus={() => setIsPickerExpanded(true)}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search languages..."
                aria-label="Search languages"
                className="geo-search-input"
              />
              <button
                type="button"
                className="geo-clear"
                onClick={clearFilters}
                aria-label="Clear filters"
              >
                <XCircle className="icon" aria-hidden="true" />
              </button>
            </div>
            {isSearchingServer && (
              <span className="control-loading" aria-live="polite">
                Searching server...
              </span>
            )}
          </div>
          <div
            className={`geo-selection-accordion${isPickerExpanded ? " is-open" : ""}`}
          >
            <div className="geo-selection-accordion-inner">
              <div className="geo-grid">
                <div className="geo-column">
                  <p className="geo-title">Regions</p>
                  <div className="geo-accordion-list">
                    {countriesByContinent.map(({ continent, countries }) => {
                      if (!continent) return null
                      const isOpen =
                        draftContinents.has(continent.id) ||
                        countries.some((country) =>
                          draftCountries.has(country.id),
                        )
                      return (
                        <details
                          key={continent.id}
                          className="geo-accordion"
                          open={isOpen}
                        >
                          <summary className="geo-accordion-summary">
                            <button
                              type="button"
                              className={`geo-filter-button${
                                draftContinents.has(continent.id)
                                  ? " is-active"
                                  : ""
                              }`}
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                toggleContinent(continent.id)
                              }}
                              aria-pressed={draftContinents.has(continent.id)}
                            >
                              {continent.name}
                            </button>
                            <span className="geo-accordion-count">
                              {countries.length}
                            </span>
                          </summary>
                          <div className="geo-accordion-panel">
                            {countries.map((country) => (
                              <button
                                key={country.id}
                                type="button"
                                className={`geo-filter-button geo-filter-button--country${
                                  draftCountries.has(country.id)
                                    ? " is-active"
                                    : ""
                                }`}
                                onClick={() => toggleCountry(country.id)}
                                aria-pressed={draftCountries.has(country.id)}
                              >
                                {countryIdToFlagEmoji(country.id)}{" "}
                                {country.name}
                              </button>
                            ))}
                          </div>
                        </details>
                      )
                    })}
                  </div>
                </div>
                <div className="geo-column geo-column--divider">
                  <p className="geo-title">Languages</p>
                  <div className="geo-list">
                    {visibleLanguages.map((language) => {
                      const speakerEstimate =
                        languageSpeakerEstimates.get(language.id) ?? 0
                      const speakerLabel = hasSelectedCountry
                        ? formatSpeakerPercentage(
                            speakerEstimate,
                            totalVisibleSpeakers,
                          )
                        : ""

                      return (
                        <label key={language.id} className="geo-option">
                          <input
                            type="checkbox"
                            checked={selectedLanguageSet.has(language.id)}
                            onChange={() => handleSelect(language.id)}
                          />
                          <span className="geo-option-content">
                            <span className="geo-option-label">
                              {language.englishLabel}
                              {language.nativeLabel &&
                              language.nativeLabel !== language.englishLabel
                                ? ` -- ${language.nativeLabel}`
                                : ""}
                            </span>
                            {speakerLabel ? (
                              <span className="geo-option-speakers">
                                {speakerLabel}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      )
                    })}
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
