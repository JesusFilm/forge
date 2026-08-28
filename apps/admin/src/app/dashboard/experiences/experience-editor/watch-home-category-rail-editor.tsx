"use client"

import { useId, useRef, useState } from "react"
import {
  Anchor,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  CirclePlay,
  Clock,
  Compass,
  Download,
  Film,
  Flower2,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  MapPin,
  Megaphone,
  MessageCircle,
  Music,
  Plus,
  Sparkles,
  Star,
  Sunrise,
  Trash2,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"
import {
  DEFAULT_WATCH_HOME_TILE_ICON,
  DEFAULT_WATCH_HOME_TILE_STYLE,
  MAX_WATCH_HOME_TILE_TITLE_LENGTH,
  WATCH_HOME_CATEGORY_BY_ID,
  WATCH_HOME_CATEGORY_TILE_DEFAULTS,
  WATCH_HOME_TILE_ICONS,
  WATCH_HOME_TILE_STYLES,
  watchHomeTileGradient,
  type WatchHomeTileIconKey,
} from "@forge/watch-url-policy/watch-home-tiles"

import {
  categoryTileId,
  nextCustomTileId,
  railTileProblems,
  type RailTile,
} from "./watch-home-category-rail-tiles"

type WatchHomeCategoryRailEditorProps = {
  tiles: readonly RailTile[]
  onChange: (tiles: RailTile[]) => void
}

// Exhaustive over the shared icon vocabulary — adding a key to the catalog
// without a glyph here is a compile error, same contract apps/web's renderer
// uses so the editor preview cannot drift from what viewers see.
const ICON_BY_KEY: Record<WatchHomeTileIconKey, LucideIcon> = {
  film: Film,
  book: BookOpen,
  clock: Clock,
  users: Users,
  heart: Heart,
  flower: Flower2,
  graduation: GraduationCap,
  trophy: Trophy,
  megaphone: Megaphone,
  anchor: Anchor,
  compass: Compass,
  sunrise: Sunrise,
  gift: Gift,
  play: CirclePlay,
  globe: Globe,
  music: Music,
  sparkles: Sparkles,
  star: Star,
  "map-pin": MapPin,
  calendar: CalendarDays,
  "message-circle": MessageCircle,
  download: Download,
}

const FIELD_CLASSES =
  "w-full rounded-sm border border-white/12 bg-black/28 px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/34 focus:border-white/28 focus:outline-none"
const INVALID_FIELD_CLASSES =
  "border-[var(--color-danger)] focus:border-[var(--color-danger)]"
const ICON_BUTTON_CLASSES =
  "inline-flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-white/70 transition-colors hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"

function tileDefaults(tile: RailTile) {
  const category =
    tile.categoryId == null
      ? undefined
      : WATCH_HOME_CATEGORY_BY_ID.get(tile.categoryId)
  if (!category) {
    return {
      label: "Custom tile",
      title: "",
      href: "",
      icon: DEFAULT_WATCH_HOME_TILE_ICON,
      style: DEFAULT_WATCH_HOME_TILE_STYLE,
    }
  }

  const presentation =
    WATCH_HOME_CATEGORY_TILE_DEFAULTS[
      category.id as keyof typeof WATCH_HOME_CATEGORY_TILE_DEFAULTS
    ]
  return {
    label: category.staffLabel,
    title: category.staffLabel,
    href: `/watch/${category.slug}.html`,
    icon: presentation.icon,
    style: presentation.style,
  }
}

/**
 * What the tile will actually look like once rendered — overrides win.
 * Reads the trimmed value because that is what gets persisted, so a field
 * holding only whitespace previews as the default rather than as blank.
 */
function tilePreview(tile: RailTile) {
  const defaults = tileDefaults(tile)
  const iconKey = (tile.icon?.trim() || defaults.icon) as WatchHomeTileIconKey
  return {
    defaults,
    label: tile.title?.trim() || defaults.label,
    Icon: ICON_BY_KEY[iconKey] ?? ICON_BY_KEY[DEFAULT_WATCH_HOME_TILE_ICON],
    gradient: watchHomeTileGradient(tile.style?.trim() || defaults.style),
  }
}

export function WatchHomeCategoryRailEditor({
  tiles,
  onChange,
}: WatchHomeCategoryRailEditorProps) {
  const helpId = useId()
  const fieldId = useId()
  const [announcement, setAnnouncement] = useState("")
  const moveButtonRefs = useRef(new Map<string, HTMLButtonElement>())

  const usedCategoryIds = new Set(
    tiles
      .map((tile) => tile.categoryId)
      .filter((id): id is string => id != null),
  )
  const availableCategories = WATCH_HOME_CATEGORY_CATALOG.filter(
    ({ id }) => !usedCategoryIds.has(id),
  )

  function restoreMoveFocus(id: string, direction: "up" | "down") {
    window.requestAnimationFrame(() => {
      moveButtonRefs.current.get(`${id}:${direction}`)?.focus()
    })
  }

  function moveTile(id: string, direction: -1 | 1) {
    const currentIndex = tiles.findIndex((tile) => tile.id === id)
    const nextIndex = currentIndex + direction
    if (currentIndex === -1 || nextIndex < 0 || nextIndex >= tiles.length) {
      return
    }

    const nextTiles = [...tiles]
    ;[nextTiles[currentIndex], nextTiles[nextIndex]] = [
      nextTiles[nextIndex],
      nextTiles[currentIndex],
    ]
    onChange(nextTiles)
    setAnnouncement(
      `${tilePreview(tiles[currentIndex]).label} moved to position ${nextIndex + 1} of ${nextTiles.length}.`,
    )
    restoreMoveFocus(id, direction === -1 ? "up" : "down")
  }

  function removeTile(id: string) {
    if (tiles.length <= 1) return
    const tile = tiles.find((candidate) => candidate.id === id)
    if (!tile) return
    const nextTiles = tiles.filter((candidate) => candidate.id !== id)
    onChange(nextTiles)
    setAnnouncement(
      `${tilePreview(tile).label} removed. ${nextTiles.length} tiles remaining.`,
    )
  }

  /**
   * An input the operator has emptied clears the override rather than
   * persisting `""` — that is what makes "edit a predefined tile, then change
   * your mind" recoverable without a separate reset control.
   *
   * The value is stored AS TYPED, not trimmed. Trimming here would fight the
   * controlled input: typing the space in "Meet Jesus" would produce a state
   * of "Meet", React would rewrite the field, and the space could never be
   * entered. Canonical trimming happens once, at serialization
   * (`serializeTile`), which is also where the persisted shape is decided.
   */
  function updateTile(
    id: string,
    patch: Partial<Pick<RailTile, "title" | "href" | "icon" | "style">>,
  ) {
    onChange(
      tiles.map((tile) => {
        if (tile.id !== id) return tile
        const next: RailTile = { ...tile }
        for (const [key, value] of Object.entries(patch)) {
          if (value == null || value.trim() === "") {
            delete next[key as "title" | "href" | "icon" | "style"]
          } else {
            next[key as "title" | "href" | "icon" | "style"] = value
          }
        }
        return next
      }),
    )
  }

  function addCategoryTile(categoryId: string) {
    if (usedCategoryIds.has(categoryId)) return
    const category = WATCH_HOME_CATEGORY_BY_ID.get(categoryId)
    if (!category) return
    const nextTiles = [...tiles, { id: categoryTileId(categoryId), categoryId }]
    onChange(nextTiles)
    setAnnouncement(
      `${category.staffLabel} added at position ${nextTiles.length} of ${nextTiles.length}.`,
    )
  }

  /**
   * Seeded with a valid title and destination. A blank new tile would fail
   * the persistence schema, so the admin would discover the problem at save
   * time on a tile they had not finished writing yet.
   */
  function addCustomTile() {
    const tile: RailTile = {
      id: nextCustomTileId(tiles),
      title: "New tile",
      href: "/watch",
      icon: DEFAULT_WATCH_HOME_TILE_ICON,
      style: DEFAULT_WATCH_HOME_TILE_STYLE,
    }
    const nextTiles = [...tiles, tile]
    onChange(nextTiles)
    setAnnouncement(
      `Custom tile added at position ${nextTiles.length} of ${nextTiles.length}.`,
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
            Add, edit, reorder, and remove the tiles in this carousel.
          </p>
        </div>
        <span className="rounded-pill border border-white/12 bg-white/6 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-white/72">
          {tiles.length} {tiles.length === 1 ? "tile" : "tiles"}
        </span>
      </div>

      <div className="mt-5 space-y-2" aria-label="Carousel tiles">
        {tiles.map((tile, index) => {
          const { defaults, label, Icon, gradient } = tilePreview(tile)
          const problems = railTileProblems(tile)
          const isOnlyTile = tiles.length === 1
          const isPredefined = tile.categoryId != null

          return (
            <div
              key={tile.id}
              data-rail-tile={tile.id}
              data-rail-tile-kind={isPredefined ? "category" : "custom"}
              className="rounded-sm border border-white/10 bg-black/18 px-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-white/10 bg-white/5 font-mono text-[10px] text-white/58">
                  {index + 1}
                </span>
                <span
                  aria-hidden="true"
                  data-rail-tile-swatch={tile.id}
                  className="relative flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm"
                  style={{ backgroundImage: gradient }}
                >
                  <Icon className="h-4 w-4 text-white opacity-70" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-white">
                    {label}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-white/48">
                    {tile.href?.trim() || defaults.href}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    ref={(node) => {
                      if (node)
                        moveButtonRefs.current.set(`${tile.id}:up`, node)
                      else moveButtonRefs.current.delete(`${tile.id}:up`)
                    }}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      moveTile(tile.id, -1)
                    }}
                    disabled={index === 0}
                    className={ICON_BUTTON_CLASSES}
                    aria-label={`Move ${label} up`}
                  >
                    <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <button
                    ref={(node) => {
                      if (node)
                        moveButtonRefs.current.set(`${tile.id}:down`, node)
                      else moveButtonRefs.current.delete(`${tile.id}:down`)
                    }}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      moveTile(tile.id, 1)
                    }}
                    disabled={index === tiles.length - 1}
                    className={ICON_BUTTON_CLASSES}
                    aria-label={`Move ${label} down`}
                  >
                    <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeTile(tile.id)
                    }}
                    disabled={isOnlyTile}
                    aria-describedby={isOnlyTile ? helpId : undefined}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-white/70 transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`Remove ${label}`}
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/44">
                    Title
                  </span>
                  <input
                    id={`${fieldId}-${tile.id}-title`}
                    value={tile.title ?? ""}
                    maxLength={MAX_WATCH_HOME_TILE_TITLE_LENGTH}
                    placeholder={
                      isPredefined
                        ? `${defaults.title} (translated)`
                        : "Tile title"
                    }
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateTile(tile.id, { title: event.target.value })
                    }
                    aria-label={`${label} title`}
                    aria-invalid={problems.includes("title") || undefined}
                    className={`${FIELD_CLASSES} ${problems.includes("title") ? INVALID_FIELD_CLASSES : ""}`}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/44">
                    Destination
                  </span>
                  <input
                    id={`${fieldId}-${tile.id}-href`}
                    value={tile.href ?? ""}
                    placeholder={defaults.href || "/watch/example.html"}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateTile(tile.id, { href: event.target.value })
                    }
                    aria-label={`${label} destination`}
                    aria-invalid={problems.includes("href") || undefined}
                    className={`${FIELD_CLASSES} ${problems.includes("href") ? INVALID_FIELD_CLASSES : ""}`}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/44">
                    Icon
                  </span>
                  <select
                    value={tile.icon ?? ""}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateTile(tile.id, { icon: event.target.value })
                    }
                    aria-label={`${label} icon`}
                    className={FIELD_CLASSES}
                  >
                    <option value="">Default ({defaults.icon})</option>
                    {WATCH_HOME_TILE_ICONS.map((icon) => (
                      <option key={icon.key} value={icon.key}>
                        {icon.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/44">
                    Style
                  </span>
                  <select
                    value={tile.style ?? ""}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateTile(tile.id, { style: event.target.value })
                    }
                    aria-label={`${label} style`}
                    className={FIELD_CLASSES}
                  >
                    <option value="">Default ({defaults.style})</option>
                    {WATCH_HOME_TILE_STYLES.map((style) => (
                      <option key={style.key} value={style.key}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {problems.length > 0 ? (
                <p
                  role="alert"
                  className="mt-2 text-[11px] leading-4 text-[var(--color-danger)]"
                >
                  {problems.includes("title")
                    ? "A custom tile needs a title. "
                    : ""}
                  {problems.includes("href")
                    ? "Destination must be a site path starting with / or an https:// URL."
                    : ""}
                </p>
              ) : isPredefined ? (
                <p className="mt-2 text-[11px] leading-4 text-white/44">
                  Leave a field blank to keep the translated default for this
                  category.
                </p>
              ) : null}
            </div>
          )
        })}
      </div>

      <p id={helpId} className="mt-3 text-[11px] leading-5 text-white/52">
        At least one tile is required. Remove the entire block to hide this
        section.
      </p>

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/46">
            Add a tile
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              addCustomTile()
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-white/14 bg-white/6 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/12"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            Custom tile
          </button>
        </div>

        {availableCategories.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {availableCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  addCategoryTile(category.id)
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
        ) : (
          <p className="mt-2 text-[11px] leading-5 text-white/44">
            Every predefined category is already on the rail.
          </p>
        )}
      </div>

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
