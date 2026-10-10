"use client"

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"
import {
  Check,
  ChevronDown,
  Clock3,
  Database,
  Globe2,
  Languages,
  Link2,
  Search,
  Volume2,
  X,
} from "lucide-react"
import { StatusPill } from "@/components/admin-ui"
import type {
  LanguageDiagnosticCounts,
  LanguageDiagnosticRow,
  LanguageDiagnosticsSummary,
} from "@/app/dashboard/ops-data"

export type LanguageOperationalFilter =
  | "all"
  | "linked"
  | "reference-only"
  | "missing-metadata"

export type LanguageGeoContentFilter =
  | "all"
  | "country-linked"
  | "no-country-links"
  | "has-dubs"
  | "has-subtitles"
  | "has-study-questions"
  | "primary-video-language"
  | "audio-preview"

export type LanguageSyncFilter =
  | "all"
  | "core-synced"
  | "sync-missing"
  | "updated-after-sync"
  | "non-core-source"

export type LanguageDiagnosticFilters = {
  operational: LanguageOperationalFilter
  geoContent: LanguageGeoContentFilter
  sync: LanguageSyncFilter
}

type FilterOption<TValue extends string = string> = {
  value: TValue
  label: string
  meta?: string
}

const defaultFilters: LanguageDiagnosticFilters = {
  operational: "all",
  geoContent: "all",
  sync: "all",
}
const COUNTRY_PREVIEW_LIMIT = 5
const SIGNAL_MENU_WIDTH = 320
const SIGNAL_MENU_VIEWPORT_GAP = 16

const operationalOptions: Array<FilterOption<LanguageOperationalFilter>> = [
  { value: "all", label: "All active" },
  { value: "linked", label: "Linked" },
  { value: "reference-only", label: "Reference only" },
  { value: "missing-metadata", label: "Missing metadata" },
]

const geoContentOptions: Array<FilterOption<LanguageGeoContentFilter>> = [
  { value: "all", label: "All usage" },
  { value: "country-linked", label: "Country linked" },
  { value: "no-country-links", label: "No country links" },
  { value: "has-dubs", label: "Has dubs" },
  { value: "has-subtitles", label: "Has subtitles" },
  { value: "has-study-questions", label: "Has study questions" },
  { value: "primary-video-language", label: "Primary video language" },
  { value: "audio-preview", label: "Audio preview" },
]

const syncOptions: Array<FilterOption<LanguageSyncFilter>> = [
  { value: "all", label: "All provenance" },
  { value: "core-synced", label: "Core synced" },
  { value: "sync-missing", label: "Sync missing" },
  { value: "updated-after-sync", label: "Updated after sync" },
  { value: "non-core-source", label: "Non-Core source" },
]

function rowButtonId(id: string) {
  return `language-diagnostic-row-${id}`
}

function normalizeSearchTokens(query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return tokens
}

function matchesLanguageSearchTokens(
  row: LanguageDiagnosticRow,
  tokens: string[],
) {
  if (tokens.length === 0) return true
  return tokens.every((token) => row.searchText.includes(token))
}

export function matchesLanguageSearch(
  row: LanguageDiagnosticRow,
  query: string,
) {
  return matchesLanguageSearchTokens(row, normalizeSearchTokens(query))
}

export function matchesLanguageFilters(
  row: LanguageDiagnosticRow,
  filters: LanguageDiagnosticFilters,
) {
  const matchesOperational =
    filters.operational === "all" ||
    (filters.operational === "linked" && row.flags.linked) ||
    (filters.operational === "reference-only" && row.flags.referenceOnly) ||
    (filters.operational === "missing-metadata" && row.flags.missingMetadata)

  const matchesGeoContent =
    filters.geoContent === "all" ||
    (filters.geoContent === "country-linked" && row.flags.countryLinked) ||
    (filters.geoContent === "no-country-links" && !row.flags.countryLinked) ||
    (filters.geoContent === "has-dubs" && row.flags.hasDubs) ||
    (filters.geoContent === "has-subtitles" && row.flags.hasSubtitles) ||
    (filters.geoContent === "has-study-questions" &&
      row.flags.hasStudyQuestions) ||
    (filters.geoContent === "primary-video-language" &&
      row.flags.primaryVideoLanguage) ||
    (filters.geoContent === "audio-preview" && row.flags.hasAudioPreview)

  const matchesSync =
    filters.sync === "all" ||
    (filters.sync === "core-synced" && row.flags.coreSynced) ||
    (filters.sync === "sync-missing" && row.flags.syncMissing) ||
    (filters.sync === "updated-after-sync" && row.flags.updatedAfterSync) ||
    (filters.sync === "non-core-source" && row.flags.nonCoreSource)

  return matchesOperational && matchesGeoContent && matchesSync
}

export function filterLanguageRows(
  rows: LanguageDiagnosticRow[],
  query: string,
  filters: LanguageDiagnosticFilters,
) {
  const tokens = normalizeSearchTokens(query)
  return rows.filter(
    (row) =>
      matchesLanguageSearchTokens(row, tokens) &&
      matchesLanguageFilters(row, filters),
  )
}

export function countryLinkOverflowLabel(row: LanguageDiagnosticRow) {
  const hiddenCount = row.counts.countryLanguages - row.countryPreviews.length
  if (hiddenCount <= 0) return null

  return `Showing first ${row.countryPreviews.length.toLocaleString("en-US")} of ${row.counts.countryLanguages.toLocaleString("en-US")} country links.`
}

function countryFlagEmoji(coreId: string) {
  const code = coreId.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return null

  return String.fromCodePoint(
    ...Array.from(code).map(
      (letter) => 0x1f1e6 + letter.charCodeAt(0) - "A".charCodeAt(0),
    ),
  )
}

function languageMark(row: LanguageDiagnosticRow) {
  return (row.bcp47 ?? row.iso3 ?? row.slug ?? row.coreId)
    .slice(0, 5)
    .toUpperCase()
}

function contentLinkLabel(row: LanguageDiagnosticRow) {
  const count = row.counts.totalContentLinks
  return `${count.toLocaleString("en-US")} content ${count === 1 ? "link" : "links"}`
}

function countryOverflowCount(
  row: LanguageDiagnosticRow,
  visibleCount: number,
) {
  return Math.max(0, row.counts.countryLanguages - visibleCount)
}

function metricValue(
  metrics: Array<{ label: string; value: string; footer: string }>,
  label: string,
  fallback: string,
) {
  return (
    metrics.find((metric) => metric.label.toLowerCase() === label)?.value ??
    fallback
  )
}

function optionMatchesSearch(option: FilterOption, search: string) {
  const query = search.replace(/\s+/g, " ").trim().toLocaleLowerCase("en")
  if (!query) return true

  return `${option.label} ${option.value} ${option.meta ?? ""}`
    .toLocaleLowerCase("en")
    .includes(query)
}

function signalMenuStyle(trigger: HTMLDivElement | null) {
  const rect = trigger?.getBoundingClientRect()
  if (!rect) return null

  const width = Math.min(
    SIGNAL_MENU_WIDTH,
    window.innerWidth - SIGNAL_MENU_VIEWPORT_GAP * 2,
  )
  const left = Math.min(
    Math.max(SIGNAL_MENU_VIEWPORT_GAP, rect.left),
    window.innerWidth - width - SIGNAL_MENU_VIEWPORT_GAP,
  )

  return {
    left,
    top: rect.bottom + 8,
    width,
  }
}

export function LanguageDiagnostics({
  rows,
  diagnostics,
  metrics = [],
}: {
  rows: LanguageDiagnosticRow[]
  diagnostics: LanguageDiagnosticsSummary
  metrics?: Array<{ label: string; value: string; footer: string }>
}) {
  const [query, setQuery] = useState("")
  const [filters, setFilters] =
    useState<LanguageDiagnosticFilters>(defaultFilters)
  const [selectedLanguageId, setSelectedLanguageId] = useState("")
  const [showSoftDeletedOnly, setShowSoftDeletedOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null
  const selectedLanguageFilterRow =
    rows.find((row) => row.id === selectedLanguageId) ?? null
  const languageOptions = useMemo<Array<FilterOption>>(
    () => [
      {
        value: "",
        label: "All languages",
        meta: `${rows.length.toLocaleString("en-US")} reference rows`,
      },
      ...rows.map((row) => ({
        value: row.id,
        label: row.title,
        meta: row.codeLabel,
      })),
    ],
    [rows],
  )
  const filteredRows = useMemo(() => {
    if (showSoftDeletedOnly) return []

    return filterLanguageRows(rows, query, filters).filter(
      (row) => !selectedLanguageId || row.id === selectedLanguageId,
    )
  }, [filters, query, rows, selectedLanguageId, showSoftDeletedOnly])
  const lastSyncFilter: LanguageSyncFilter = diagnostics.lastSyncedAtIso
    ? "core-synced"
    : "sync-missing"
  const languageCountValue = metricValue(
    metrics,
    "languages",
    rows.length.toLocaleString("en-US"),
  )
  const countryCountValue = metricValue(metrics, "countries", "0")
  const localesInUseValue = metricValue(metrics, "locales in use", "0")
  const softDeletedValue =
    diagnostics.softDeletedLanguages.toLocaleString("en-US")

  useEffect(() => {
    if (!selectedRow) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.setTimeout(() => closeButtonRef.current?.focus(), 0)

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedRow])

  function closeModal() {
    const previousSelectedId = selectedId
    setSelectedId(null)

    if (previousSelectedId) {
      window.setTimeout(
        () => document.getElementById(rowButtonId(previousSelectedId))?.focus(),
        0,
      )
    }
  }

  function updateFilters(
    updater:
      | LanguageDiagnosticFilters
      | ((current: LanguageDiagnosticFilters) => LanguageDiagnosticFilters),
  ) {
    setShowSoftDeletedOnly(false)
    setFilters(updater)
  }

  function selectLanguageFilter(value: string) {
    setShowSoftDeletedOnly(false)
    setSelectedLanguageId(value)
  }

  function toggleCountryFilter() {
    updateFilters((current) => ({
      ...current,
      geoContent:
        current.geoContent === "country-linked" ? "all" : "country-linked",
    }))
  }

  function toggleLocaleUsageFilter() {
    updateFilters((current) => ({
      ...current,
      operational: current.operational === "linked" ? "all" : "linked",
    }))
  }

  function toggleLastSyncFilter() {
    updateFilters((current) => ({
      ...current,
      sync: current.sync === lastSyncFilter ? "all" : lastSyncFilter,
    }))
  }

  function toggleSoftDeletedFilter() {
    setShowSoftDeletedOnly((current) => !current)
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      closeModal()
      return
    }

    if (event.key !== "Tab") return

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("disabled"))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-3" role="search">
        <label htmlFor="language-library-search" className="sr-only">
          Search languages
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
            strokeWidth={1.5}
          />
          <input
            id="language-library-search"
            type="search"
            value={query}
            onChange={(event) => {
              setShowSoftDeletedOnly(false)
              setQuery(event.target.value)
            }}
            placeholder="Search languages, IDs, codes, countries..."
            className="h-10 w-full rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] pl-9 pr-10 font-mono text-[12px] text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out placeholder:text-[var(--color-text-disabled)] focus:border-[var(--color-brand)] focus:bg-[var(--color-surface-raised)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-all duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              aria-label="Clear language search"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          ) : null}
        </div>

        <div
          aria-label="Language filters"
          className="-mx-1 flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:thin]"
        >
          <SelectFilter
            className="w-[176px]"
            label="Operational state"
            value={filters.operational}
            options={operationalOptions}
            onChange={(value) =>
              updateFilters((current) => ({ ...current, operational: value }))
            }
          />
          <SelectFilter
            className="w-[212px]"
            label="Geo and content"
            value={filters.geoContent}
            options={geoContentOptions}
            onChange={(value) =>
              updateFilters((current) => ({ ...current, geoContent: value }))
            }
          />
          <SelectFilter
            className="w-[196px]"
            label="Sync provenance"
            value={filters.sync}
            options={syncOptions}
            onChange={(value) =>
              updateFilters((current) => ({ ...current, sync: value }))
            }
          />
        </div>
      </div>

      <div
        role="group"
        aria-label="Language signal filters"
        className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-muted)]"
      >
        <SearchableSignalFilter
          label="Languages"
          value={selectedLanguageFilterRow?.title ?? languageCountValue}
          active={Boolean(selectedLanguageFilterRow)}
          selectedValue={selectedLanguageId}
          options={languageOptions}
          placeholder="Search languages..."
          noResultsLabel="No languages found"
          onSelect={selectLanguageFilter}
        />
        <SignalFilterButton
          label="Countries"
          value={countryCountValue}
          active={filters.geoContent === "country-linked"}
          ariaLabel="Filter to country-linked languages"
          onClick={toggleCountryFilter}
        />
        <SignalFilterButton
          label="Locales In Use"
          value={localesInUseValue}
          active={filters.operational === "linked"}
          ariaLabel="Filter to linked languages"
          onClick={toggleLocaleUsageFilter}
        />
        <SignalFilterButton
          icon={<Clock3 className="h-3.5 w-3.5" strokeWidth={1.5} />}
          label="Last sync"
          value={diagnostics.lastSyncedAt}
          active={filters.sync === lastSyncFilter}
          ariaLabel="Filter by sync status"
          onClick={toggleLastSyncFilter}
        />
        <SignalFilterButton
          icon={<Database className="h-3.5 w-3.5" strokeWidth={1.5} />}
          label="Soft deleted"
          value={softDeletedValue}
          active={showSoftDeletedOnly}
          ariaLabel="Filter to soft-deleted languages"
          onClick={toggleSoftDeletedFilter}
        />
      </div>

      <section
        className="app-card min-w-0 overflow-hidden"
        aria-label="Language library results"
      >
        {filteredRows.length > 0 ? (
          filteredRows.map((row) => (
            <LanguageRow
              key={row.id}
              row={row}
              onSelect={() => setSelectedId(row.id)}
            />
          ))
        ) : (
          <div className="px-4 py-12 text-center text-[13px] text-[var(--color-text-muted)]">
            {showSoftDeletedOnly
              ? "No soft-deleted languages are present in this active reference list."
              : "No languages match the current search and filters."}
          </div>
        )}
      </section>

      {selectedRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="language-diagnostic-title"
            className="flex max-h-[min(820px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-sm border border-white/15 bg-[var(--color-surface-elevated)] shadow-2xl"
            onKeyDown={handleDialogKeyDown}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <div className="label-text mb-1">Language Detail</div>
                <h2
                  id="language-diagnostic-title"
                  className="truncate text-xl font-semibold"
                >
                  {selectedRow.title}
                </h2>
                <div className="mono-meta mt-1 truncate text-[var(--color-text-muted)]">
                  {selectedRow.codeLabel}
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-white/10 text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                aria-label="Close language detail"
              >
                <X className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>

            <div
              className="overflow-y-auto px-5 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-brand)]"
              tabIndex={0}
              aria-label="Language detail sections"
            >
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
                <div className="flex min-w-0 flex-col gap-5">
                  <DetailSection
                    icon={<Languages className="h-4 w-4" strokeWidth={1.5} />}
                    title="Identity"
                  >
                    <DetailGrid>
                      <DetailField label="Database ID" value={selectedRow.id} />
                      <DetailField label="Core ID" value={selectedRow.coreId} />
                      <DetailField label="Source" value={selectedRow.source} />
                      <DetailField label="BCP-47" value={selectedRow.bcp47} />
                      <DetailField label="ISO3" value={selectedRow.iso3} />
                      <DetailField label="Slug" value={selectedRow.slug} />
                    </DetailGrid>
                  </DetailSection>

                  <DetailSection
                    icon={<Globe2 className="h-4 w-4" strokeWidth={1.5} />}
                    title="Localized Names"
                  >
                    {selectedRow.names.length > 0 ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {selectedRow.names.map((name) => (
                          <DetailField
                            key={`${name.locale}-${name.value}`}
                            label={
                              name.primary
                                ? `${name.locale} primary`
                                : name.locale
                            }
                            value={name.value}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyDetail value="No localized names" />
                    )}
                  </DetailSection>

                  <DetailSection
                    icon={<Link2 className="h-4 w-4" strokeWidth={1.5} />}
                    title="Country Links"
                  >
                    {selectedRow.countryPreviews.length > 0 ? (
                      <div className="grid gap-2">
                        {selectedRow.countryPreviews.map((country) => (
                          <div
                            key={country.id}
                            className="rounded-sm border border-white/10 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium">
                                {country.label}
                              </span>
                              {country.primary ? (
                                <StatusPill tone="success">Primary</StatusPill>
                              ) : null}
                              {country.suggested ? (
                                <StatusPill tone="info">Suggested</StatusPill>
                              ) : null}
                            </div>
                            <div className="mono-meta mt-1 text-[var(--color-text-muted)]">
                              {country.continentLabel
                                ? `${country.continentLabel} / ${country.speakers}`
                                : country.speakers}
                            </div>
                          </div>
                        ))}
                        {countryLinkOverflowLabel(selectedRow) ? (
                          <div className="rounded-sm border border-dashed border-white/15 px-3 py-2 text-[13px] text-[var(--color-text-muted)]">
                            {countryLinkOverflowLabel(selectedRow)}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <EmptyDetail value="No country links" />
                    )}
                  </DetailSection>
                </div>

                <div className="flex min-w-0 flex-col gap-5">
                  <DetailSection
                    icon={<Database className="h-4 w-4" strokeWidth={1.5} />}
                    title="Coverage Counts"
                  >
                    <CountsGrid counts={selectedRow.counts} />
                  </DetailSection>

                  <DetailSection
                    icon={<Volume2 className="h-4 w-4" strokeWidth={1.5} />}
                    title="Audio Preview"
                  >
                    <DetailGrid>
                      <DetailField
                        label="Value"
                        value={selectedRow.audioPreview.value}
                      />
                      <DetailField
                        label="Duration"
                        value={selectedRow.audioPreview.duration}
                      />
                      <DetailField
                        label="Size"
                        value={selectedRow.audioPreview.size}
                      />
                      <DetailField
                        label="Bitrate"
                        value={selectedRow.audioPreview.bitrate}
                      />
                      <DetailField
                        label="Codec"
                        value={selectedRow.audioPreview.codec}
                      />
                    </DetailGrid>
                  </DetailSection>

                  <DetailSection
                    icon={<Clock3 className="h-4 w-4" strokeWidth={1.5} />}
                    title="Provenance"
                  >
                    <div className="mb-3 flex flex-wrap gap-2">
                      <StatusPill tone={selectedRow.statusTone}>
                        {selectedRow.statusLabel}
                      </StatusPill>
                      <StatusPill tone={selectedRow.syncTone}>
                        {selectedRow.syncLabel}
                      </StatusPill>
                    </div>
                    <DetailGrid>
                      <DetailField
                        label="Created"
                        value={selectedRow.timestamps.createdAt}
                      />
                      <DetailField
                        label="Updated"
                        value={selectedRow.timestamps.updatedAt}
                      />
                      <DetailField
                        label="Synced"
                        value={selectedRow.timestamps.syncedAt}
                      />
                    </DetailGrid>
                  </DetailSection>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SelectFilter<TValue extends string>({
  className,
  label,
  value,
  options,
  onChange,
}: {
  className?: string
  label: string
  value: TValue
  options: Array<FilterOption<TValue>>
  onChange: (value: TValue) => void
}) {
  return (
    <label className={`relative block min-w-0 shrink-0 ${className ?? ""}`}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as TValue)}
        className="h-10 w-full appearance-none rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] pl-3 pr-9 text-[12px] font-medium text-[var(--color-text-primary)] outline-none transition-all duration-[120ms] ease-out hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] focus:border-[var(--color-brand)] focus:bg-[var(--color-surface-raised)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
        strokeWidth={1.5}
      />
    </label>
  )
}

function signalControlClass(active: boolean) {
  return [
    "inline-flex h-8 items-center gap-2 rounded-sm border px-2.5 text-left outline-none transition-all duration-[120ms] ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
    active
      ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]"
      : "border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]",
  ].join(" ")
}

function SearchableSignalFilter({
  active,
  label,
  noResultsLabel,
  onSelect,
  options,
  placeholder,
  selectedValue,
  value,
}: {
  active: boolean
  label: string
  noResultsLabel: string
  onSelect: (value: string) => void
  options: FilterOption[]
  placeholder: string
  selectedValue: string
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [menuStyle, setMenuStyle] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const controlId = useId()
  const listboxId = `${controlId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const filteredOptions = useMemo(
    () => options.filter((option) => optionMatchesSearch(option, searchValue)),
    [options, searchValue],
  )

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }
    const handleViewportChange = () => setOpen(false)

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [open])

  function toggleOpen() {
    if (open) {
      setOpen(false)
      return
    }

    setSearchValue("")
    setMenuStyle(signalMenuStyle(rootRef.current))
    setOpen(true)
  }

  function selectOption(
    optionValue: string,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault()
    setOpen(false)
    onSelect(optionValue)
  }

  return (
    <div ref={rootRef} className="relative min-w-0 shrink-0">
      <button
        type="button"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Filter by language"
        className={signalControlClass(active)}
        onClick={toggleOpen}
        role="combobox"
      >
        <span className="label-text leading-none">{label}</span>
        <span className="max-w-[170px] truncate font-mono text-[11px] font-medium text-[var(--color-text-primary)]">
          {value}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]"
          strokeWidth={1.5}
        />
      </button>

      {open ? (
        <div
          className="fixed z-40 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          style={menuStyle ?? undefined}
        >
          <label className="mb-1 flex h-9 items-center gap-2 rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg)] px-2">
            <Search
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]"
              strokeWidth={1.5}
            />
            <span className="sr-only">{label}</span>
            <input
              ref={searchInputRef}
              type="search"
              value={searchValue}
              onChange={(event) => setSearchValue(event.currentTarget.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
            />
          </label>

          <div
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="max-h-64 overflow-y-auto overscroll-contain py-0.5 [scrollbar-width:thin]"
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const selected = option.value === selectedValue

                return (
                  <button
                    key={option.value || "all"}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={(event) => selectOption(option.value, event)}
                    className="flex min-h-9 w-full items-center justify-between gap-3 rounded-[2px] px-2 py-1 text-left text-[12px] text-[var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-surface-raised)] focus-visible:text-[var(--color-text-primary)] focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{option.label}</span>
                      {option.meta ? (
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                          {option.meta}
                        </span>
                      ) : null}
                    </span>
                    <Check
                      aria-hidden="true"
                      className={
                        selected
                          ? "h-3.5 w-3.5 shrink-0 text-[var(--color-success)] opacity-100"
                          : "h-3.5 w-3.5 shrink-0 opacity-0"
                      }
                      strokeWidth={1.5}
                    />
                  </button>
                )
              })
            ) : (
              <div className="px-2 py-4 text-center text-[12px] text-[var(--color-text-muted)]">
                {noResultsLabel}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SignalFilterButton({
  active,
  ariaLabel,
  icon,
  label,
  onClick,
  value,
}: {
  active: boolean
  ariaLabel: string
  icon?: ReactNode
  label: string
  onClick: () => void
  value: string
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={signalControlClass(active)}
    >
      {icon ? (
        <span className="text-[var(--color-text-muted)]">{icon}</span>
      ) : null}
      <span className="label-text leading-none">{label}</span>
      <span className="font-mono text-[11px] font-medium text-[var(--color-text-primary)]">
        {value}
      </span>
    </button>
  )
}

function LanguageRow({
  row,
  onSelect,
}: {
  row: LanguageDiagnosticRow
  onSelect: () => void
}) {
  const visibleCountries = row.countryPreviews.slice(0, COUNTRY_PREVIEW_LIMIT)
  const hiddenCountries = countryOverflowCount(row, visibleCountries.length)

  return (
    <button
      id={rowButtonId(row.id)}
      type="button"
      onClick={onSelect}
      className="group grid w-full gap-4 border-b border-[var(--color-hairline)] px-4 py-4 text-left transition-colors duration-[120ms] ease-out last:border-b-0 hover:bg-[var(--color-surface-raised)] focus-visible:bg-[var(--color-brand-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-brand)] lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)_minmax(220px,0.8fr)_132px] lg:items-center"
      aria-haspopup="dialog"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <Languages
            className="mb-0.5 h-3.5 w-3.5 text-[var(--color-info)]"
            strokeWidth={1.6}
          />
          <span className="max-w-[42px] truncate font-mono text-[10px] font-semibold uppercase leading-none text-[var(--color-text-secondary)]">
            {languageMark(row)}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[18px] font-semibold leading-6 text-[var(--color-text-primary)]">
            {row.title}
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4 text-[var(--color-text-muted)]">
            <span className="max-w-[240px] truncate font-mono text-[11px]">
              {row.codeLabel}
            </span>
            <span
              aria-hidden="true"
              className="h-1 w-1 rounded-full bg-[var(--color-hairline-strong)]"
            />
            <span className="font-mono text-[11px] uppercase">
              {row.source}
            </span>
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill tone={row.statusTone}>{row.statusLabel}</StatusPill>
            <StatusPill tone={row.syncTone}>{row.syncLabel}</StatusPill>
          </span>
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex items-end gap-2">
          <span className="font-mono text-[22px] font-semibold leading-none text-[var(--color-text-primary)]">
            {row.counts.videoDubs.toLocaleString("en-US")}
          </span>
          <span className="text-[12px] text-[var(--color-text-muted)]">
            dubs
          </span>
        </div>
        <div className="mono-meta mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[var(--color-text-muted)]">
          <span>
            {row.counts.videoSubtitles.toLocaleString("en-US")} subtitles
          </span>
          <span>
            {row.counts.studyQuestions.toLocaleString("en-US")} study questions
          </span>
          <span>{contentLinkLabel(row)}</span>
        </div>
      </div>

      <div className="min-w-0">
        <div className="flex items-end gap-2">
          <span className="font-mono text-[22px] font-semibold leading-none text-[var(--color-text-primary)]">
            {row.counts.countryLanguages.toLocaleString("en-US")}
          </span>
          <span className="text-[12px] text-[var(--color-text-muted)]">
            countries
          </span>
        </div>
        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
          {visibleCountries.length > 0 ? (
            visibleCountries.map((country) => (
              <CountryChip key={country.id} country={country} />
            ))
          ) : (
            <span className="text-[11px] text-[var(--color-text-disabled)]">
              No country links
            </span>
          )}
          {hiddenCountries > 0 ? (
            <span className="px-1 font-mono text-[11px] text-[var(--color-text-muted)]">
              +{hiddenCountries.toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
      </div>

      <time
        dateTime={row.timestamps.updatedAtIso}
        title={row.timestamps.updatedAt}
        className="text-left lg:text-right"
      >
        <span className="block text-[12px] font-semibold leading-4 text-[var(--color-text-secondary)]">
          Updated
        </span>
        <span className="mt-1 block font-mono text-[10px] text-[var(--color-text-muted)]">
          {row.timestamps.updatedAt}
        </span>
        <span className="mt-2 inline-flex h-7 items-center rounded-sm border border-[var(--color-hairline)] px-2 font-mono text-[10px] font-semibold uppercase text-[var(--color-text-muted)] transition-colors duration-[120ms] ease-out group-hover:border-[var(--color-hairline-strong)] group-hover:text-[var(--color-text-secondary)]">
          Details
        </span>
      </time>
    </button>
  )
}

function CountryChip({
  country,
}: {
  country: LanguageDiagnosticRow["countryPreviews"][number]
}) {
  const flag = countryFlagEmoji(country.coreId)
  const chipTitle = [country.label, country.continentLabel, country.speakers]
    .filter(Boolean)
    .join(" / ")

  return (
    <span
      className="inline-flex max-w-[190px] items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-1.5 py-1 leading-none text-[var(--color-text-secondary)]"
      title={chipTitle}
    >
      <span
        aria-hidden="true"
        className="flex h-4 min-w-6 items-center justify-center overflow-hidden rounded-[1px] bg-[var(--color-bg)] text-[10px] leading-none"
      >
        {country.flagUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={country.flagUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          (flag ?? country.coreId.slice(0, 2).toUpperCase())
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-semibold">
          {country.label}
        </span>
        {country.continentLabel ? (
          <span className="mt-0.5 block truncate font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
            {country.continentLabel}
          </span>
        ) : null}
      </span>
    </span>
  )
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[var(--color-text-muted)]">{icon}</span>
        <h3 className="label-text">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2">{children}</div>
}

function DetailField({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div className="min-w-0 rounded-sm border border-white/10 px-3 py-2">
      <div className="label-text leading-none">{label}</div>
      <div className="mono-meta mt-2 break-words text-[var(--color-text)]">
        {value?.trim() ? value : "None"}
      </div>
    </div>
  )
}

function EmptyDetail({ value }: { value: string }) {
  return (
    <div className="rounded-sm border border-dashed border-white/15 px-3 py-4 text-[13px] text-[var(--color-text-muted)]">
      {value}
    </div>
  )
}

function CountsGrid({ counts }: { counts: LanguageDiagnosticCounts }) {
  const items = [
    { label: "Countries", value: counts.countryLanguages },
    { label: "Dubs", value: counts.videoDubs },
    { label: "Subtitles", value: counts.videoSubtitles },
    { label: "Study questions", value: counts.studyQuestions },
    { label: "Primary videos", value: counts.primaryVideos },
    { label: "Content links", value: counts.totalContentLinks },
  ]

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-sm border border-white/10 px-3 py-2"
        >
          <div className="label-text leading-none">{item.label}</div>
          <div className="mt-2 font-mono text-[15px]">
            {item.value.toLocaleString("en-US")}
          </div>
        </div>
      ))}
    </div>
  )
}
