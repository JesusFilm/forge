"use client"

/**
 * R7 — one destination from the catalog: a video, a series, or an experience.
 *
 * The search runs on the server, so the page never ships the whole video
 * catalog to a browser to filter it there.
 */
import { Search, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { SecondaryButton, cx } from "@/components/admin-ui"
import type { PushDestinationOption } from "@/services/push/dashboard.service"

import { searchDestinationsAction } from "../actions"

type Kind = "VIDEO" | "SERIES" | "EXPERIENCE"

const KINDS: ReadonlyArray<{ kind: Kind; label: string }> = [
  { kind: "VIDEO", label: "Video" },
  { kind: "SERIES", label: "Series" },
  { kind: "EXPERIENCE", label: "Experience" },
]

export type DestinationValue = { kind: Kind; slug: string }

export function DestinationPicker({
  value,
  title,
  onChange,
}: {
  value: DestinationValue | null
  title: string | null
  onChange: (next: DestinationValue) => void
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>(value?.kind ?? "SERIES")
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<PushDestinationOption[]>([])
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  // Only the newest search may write to the list; an older answer is dropped.
  const requestRef = useRef(0)

  const runSearch = useCallback(async (nextKind: Kind, nextQuery: string) => {
    const token = ++requestRef.current
    setPending(true)
    setFailed(false)
    try {
      const found = await searchDestinationsAction({
        kind: nextKind,
        query: nextQuery,
      })
      if (requestRef.current !== token) return
      setRows(found)
    } catch {
      if (requestRef.current !== token) return
      setRows([])
      setFailed(true)
    } finally {
      if (requestRef.current === token) setPending(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => void runSearch(kind, query), 250)
    return () => clearTimeout(timer)
  }, [open, kind, query, runSearch])

  return (
    <div className="grid gap-2">
      <div
        data-testid="push-destination-value"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="mono-meta rounded-sm border border-[var(--color-hairline)] px-2 py-1 text-[var(--color-text-primary)]">
          {value
            ? `${value.kind.toLowerCase()} / ${value.slug}`
            : "No destination chosen"}
        </span>
        {title ? (
          <span className="text-[12px] text-[var(--color-text-muted)]">
            {title}
          </span>
        ) : null}
        <SecondaryButton
          type="button"
          data-testid="push-destination-open"
          onClick={() => setOpen(true)}
        >
          {value ? "Change destination" : "Choose a destination"}
        </SecondaryButton>
      </div>

      {/* Both halves travel with the form, so the action reads one pair. */}
      <input type="hidden" name="destinationKind" value={value?.kind ?? ""} />
      <input type="hidden" name="destinationSlug" value={value?.slug ?? ""} />

      {open ? (
        <div
          role="presentation"
          data-testid="push-destination-picker"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
          className="fixed inset-0 z-[120] flex items-start justify-center bg-black/50 p-4 sm:items-center"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a destination"
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-sm border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] shadow-xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-hairline)] px-5 py-4">
              <div>
                <div className="label-text">Destination</div>
                <h2 className="mt-1 text-[16px] font-semibold tracking-[-0.02em]">
                  Choose what the notification opens
                </h2>
                <p className="mt-1 max-w-md text-[12px] leading-5 text-[var(--color-text-muted)]">
                  The app opens this destination on tap. A destination that has
                  been unpublished shows that route&apos;s own not-found screen.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close the destination picker"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="shrink-0 border-b border-[var(--color-hairline)] px-5 py-3">
              <div
                role="tablist"
                aria-label="Destination kind"
                className="flex flex-wrap gap-2"
              >
                {KINDS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    role="tab"
                    aria-selected={kind === option.kind}
                    data-testid={`push-destination-kind-${option.kind}`}
                    onClick={() => setKind(option.kind)}
                    className={cx(
                      "inline-flex h-8 cursor-pointer items-center rounded-sm border px-3 text-[12px] font-medium",
                      kind === option.kind
                        ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]"
                        : "border-[var(--color-hairline)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)]",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="mt-3 grid gap-1.5">
                <span className="sr-only">Search the catalog</span>
                <div className="flex h-10 items-center gap-2 rounded-sm border border-[var(--color-hairline)] bg-[var(--color-surface-raised)] px-3">
                  <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
                  <input
                    value={query}
                    data-testid="push-destination-search"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search a title or a slug"
                    className="w-full border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-disabled)]"
                  />
                </div>
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {pending ? (
                <p className="m-3 text-[12px] text-[var(--color-text-muted)]">
                  Searching...
                </p>
              ) : failed ? (
                <p
                  data-testid="push-destination-failed"
                  className="m-3 text-[12px] text-[var(--color-danger)]"
                >
                  The catalog search did not answer. Try again.
                </p>
              ) : rows.length === 0 ? (
                <p
                  data-testid="push-destination-empty"
                  className="m-3 text-[12px] text-[var(--color-text-muted)]"
                >
                  Nothing matches that search.
                </p>
              ) : (
                <ul className="grid gap-1">
                  {rows.map((row) => (
                    <li key={`${row.kind}:${row.slug}`}>
                      <button
                        type="button"
                        data-testid="push-destination-row"
                        onClick={() => {
                          onChange({ kind: row.kind as Kind, slug: row.slug })
                          setOpen(false)
                        }}
                        className="grid w-full cursor-pointer gap-0.5 rounded-sm border border-transparent px-3 py-2.5 text-left hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-raised)]"
                      >
                        <span className="truncate text-[14px] font-medium text-[var(--color-text-primary)]">
                          {row.title}
                        </span>
                        <span className="mono-meta truncate text-[var(--color-text-muted)]">
                          {row.meta}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
