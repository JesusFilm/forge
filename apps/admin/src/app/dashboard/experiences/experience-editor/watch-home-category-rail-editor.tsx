"use client"

import { useId, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import {
  WATCH_HOME_CATEGORY_CATALOG,
  type WatchHomeCategoryId,
} from "@forge/watch-url-policy/watch-home-categories"

type WatchHomeCategoryRailEditorProps = {
  categoryIds: readonly string[]
  onChange: (categoryIds: WatchHomeCategoryId[]) => void
}

const CATEGORY_BY_ID = new Map(
  WATCH_HOME_CATEGORY_CATALOG.map((category) => [category.id, category]),
)

function selectedCategoryIds(categoryIds: readonly string[]) {
  const seen = new Set<WatchHomeCategoryId>()
  const selected: WatchHomeCategoryId[] = []

  for (const id of categoryIds) {
    if (!CATEGORY_BY_ID.has(id as WatchHomeCategoryId)) continue
    const categoryId = id as WatchHomeCategoryId
    if (seen.has(categoryId)) continue
    seen.add(categoryId)
    selected.push(categoryId)
  }

  return selected
}

export function WatchHomeCategoryRailEditor({
  categoryIds,
  onChange,
}: WatchHomeCategoryRailEditorProps) {
  const helpId = useId()
  const [announcement, setAnnouncement] = useState("")
  const moveButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedIds = selectedCategoryIds(categoryIds)
  const selectedIdSet = new Set(selectedIds)
  const availableCategories = WATCH_HOME_CATEGORY_CATALOG.filter(
    ({ id }) => !selectedIdSet.has(id),
  )

  function restoreMoveFocus(id: WatchHomeCategoryId, direction: "up" | "down") {
    window.requestAnimationFrame(() => {
      moveButtonRefs.current.get(`${id}:${direction}`)?.focus()
    })
  }

  function moveCategory(id: WatchHomeCategoryId, direction: -1 | 1) {
    const currentIndex = selectedIds.indexOf(id)
    const nextIndex = currentIndex + direction
    if (
      currentIndex === -1 ||
      nextIndex < 0 ||
      nextIndex >= selectedIds.length
    ) {
      return
    }

    const nextIds = [...selectedIds]
    ;[nextIds[currentIndex], nextIds[nextIndex]] = [
      nextIds[nextIndex],
      nextIds[currentIndex],
    ]
    const category = CATEGORY_BY_ID.get(id)!
    onChange(nextIds)
    setAnnouncement(
      `${category.staffLabel} moved to position ${nextIndex + 1} of ${nextIds.length}.`,
    )
    restoreMoveFocus(id, direction === -1 ? "up" : "down")
  }

  function removeCategory(id: WatchHomeCategoryId) {
    if (selectedIds.length <= 1) return
    const category = CATEGORY_BY_ID.get(id)!
    const nextIds = selectedIds.filter((categoryId) => categoryId !== id)
    onChange(nextIds)
    setAnnouncement(
      `${category.staffLabel} removed. ${nextIds.length} tiles selected.`,
    )
  }

  function addCategory(id: WatchHomeCategoryId) {
    if (selectedIdSet.has(id)) return
    const category = CATEGORY_BY_ID.get(id)!
    const nextIds = [...selectedIds, id]
    onChange(nextIds)
    setAnnouncement(
      `${category.staffLabel} added at position ${nextIds.length} of ${nextIds.length}.`,
    )
  }

  return (
    <div className="rounded-sm bg-[linear-gradient(160deg,#151218_0%,#21192d_52%,#121018_100%)] p-5 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-brand)]">
            Browse the library
          </div>
          <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-white">
            Browse by category
          </h3>
          <p className="mt-1 text-[12px] leading-5 text-white/62">
            Choose which tiles appear and arrange their carousel order.
          </p>
        </div>
        <span className="rounded-pill border border-white/12 bg-white/6 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white/72">
          {selectedIds.length} selected
        </span>
      </div>

      <div className="mt-5 space-y-2" aria-label="Selected category tiles">
        {selectedIds.map((id, index) => {
          const category = CATEGORY_BY_ID.get(id)!
          const isOnlyCategory = selectedIds.length === 1

          return (
            <div
              key={id}
              data-selected-category={id}
              className="flex min-h-14 items-center gap-3 rounded-sm border border-white/10 bg-black/18 px-3 py-2"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-white/5 font-mono text-[10px] text-white/58">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-white">
                  {category.staffLabel}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-white/48">
                  /watch/{category.slug}.html
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  ref={(node) => {
                    if (node) moveButtonRefs.current.set(`${id}:up`, node)
                    else moveButtonRefs.current.delete(`${id}:up`)
                  }}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    moveCategory(id, -1)
                  }}
                  disabled={index === 0}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-white/70 transition-colors hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Move ${category.staffLabel} up`}
                >
                  <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button
                  ref={(node) => {
                    if (node) moveButtonRefs.current.set(`${id}:down`, node)
                    else moveButtonRefs.current.delete(`${id}:down`)
                  }}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    moveCategory(id, 1)
                  }}
                  disabled={index === selectedIds.length - 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-white/70 transition-colors hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Move ${category.staffLabel} down`}
                >
                  <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeCategory(id)
                  }}
                  disabled={isOnlyCategory}
                  aria-describedby={isOnlyCategory ? helpId : undefined}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-white/70 transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={`Remove ${category.staffLabel}`}
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p id={helpId} className="mt-3 text-[11px] leading-5 text-white/52">
        At least one tile is required. Remove the entire block to hide this
        section.
      </p>

      {availableCategories.length > 0 ? (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/46">
            Available tiles
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {availableCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  addCategory(category.id)
                }}
                className="flex min-h-12 cursor-pointer items-center gap-2 rounded-sm border border-white/10 bg-black/14 px-3 py-2 text-left transition-colors hover:bg-white/7"
                aria-label={`Add ${category.staffLabel}`}
              >
                <Plus
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-white/56"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-white/84">
                    {category.staffLabel}
                  </span>
                  <span className="block truncate font-mono text-[9px] text-white/42">
                    /watch/{category.slug}.html
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>
    </div>
  )
}
