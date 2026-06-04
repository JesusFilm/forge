"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import {
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

const defaultFilters: LanguageDiagnosticFilters = {
  operational: "all",
  geoContent: "all",
  sync: "all",
}
const COUNTRY_PREVIEW_LIMIT = 5

const operationalOptions: Array<{
  value: LanguageOperationalFilter
  label: string
}> = [
  { value: "all", label: "All active" },
  { value: "linked", label: "Linked" },
  { value: "reference-only", label: "Reference only" },
  { value: "missing-metadata", label: "Missing metadata" },
]

const geoContentOptions: Array<{
  value: LanguageGeoContentFilter
  label: string
}> = [
  { value: "all", label: "All usage" },
  { value: "country-linked", label: "Country linked" },
  { value: "no-country-links", label: "No country links" },
  { value: "has-dubs", label: "Has dubs" },
  { value: "has-subtitles", label: "Has subtitles" },
  { value: "has-study-questions", label: "Has study questions" },
  { value: "primary-video-language", label: "Primary video language" },
  { value: "audio-preview", label: "Audio preview" },
]

const syncOptions: Array<{ value: LanguageSyncFilter; label: string }> = [
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null
  const filteredRows = useMemo(
    () => filterLanguageRows(rows, query, filters),
    [rows, query, filters],
  )

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
            onChange={(event) => setQuery(event.target.value)}
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
              setFilters((current) => ({ ...current, operational: value }))
            }
          />
          <SelectFilter
            className="w-[212px]"
            label="Geo and content"
            value={filters.geoContent}
            options={geoContentOptions}
            onChange={(value) =>
              setFilters((current) => ({ ...current, geoContent: value }))
            }
          />
          <SelectFilter
            className="w-[196px]"
            label="Sync provenance"
            value={filters.sync}
            options={syncOptions}
            onChange={(value) =>
              setFilters((current) => ({ ...current, sync: value }))
            }
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
        <LibrarySignal
          icon={<Languages className="h-3.5 w-3.5" strokeWidth={1.5} />}
          label="Visible"
          value={`${filteredRows.length.toLocaleString("en-US")} / ${rows.length.toLocaleString("en-US")}`}
        />
        {metrics.map((metric) => (
          <LibrarySignal
            key={metric.label}
            label={metric.label}
            value={metric.value}
          />
        ))}
        <LibrarySignal
          icon={<Clock3 className="h-3.5 w-3.5" strokeWidth={1.5} />}
          label="Last sync"
          value={diagnostics.lastSyncedAt}
        />
        <LibrarySignal
          icon={<Database className="h-3.5 w-3.5" strokeWidth={1.5} />}
          label="Soft deleted"
          value={diagnostics.softDeletedLanguages.toLocaleString("en-US")}
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
            No languages match the current search and filters.
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
                              {country.coreId} / {country.speakers}
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
  options: Array<{ value: TValue; label: string }>
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

function LibrarySignal({
  icon,
  label,
  value,
}: {
  icon?: ReactNode
  label: string
  value: string
}) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5">
      {icon ? (
        <span className="text-[var(--color-text-muted)]">{icon}</span>
      ) : null}
      <span className="label-text leading-none">{label}</span>
      <span className="font-mono text-[11px] font-medium text-[var(--color-text-primary)]">
        {value}
      </span>
    </span>
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

  return (
    <span
      className="inline-flex max-w-[128px] items-center gap-1.5 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-1.5 py-1 font-mono text-[10px] font-semibold leading-none text-[var(--color-text-secondary)]"
      title={`${country.label} / ${country.speakers}`}
    >
      <span
        aria-hidden="true"
        className="flex h-3.5 min-w-5 items-center justify-center overflow-hidden rounded-[1px] bg-[var(--color-bg)] text-[10px] leading-none"
      >
        {flag ?? country.coreId.slice(0, 2).toUpperCase()}
      </span>
      <span className="truncate">{country.coreId}</span>
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
