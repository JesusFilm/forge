/**
 * Editor-side normalization for the Watch homepage category rail's tiles.
 *
 * Kept free of React so the reorder / add / remove / mirror rules can be
 * tested directly — the editor component is a thin renderer over these.
 *
 * The editor always works on a `tiles` array even when the persisted block
 * predates tile authoring: `readRailTiles` derives one from `categoryIds` so
 * every interaction has a single shape to manipulate. `categoryIdsFromTiles`
 * mirrors back, which is what keeps the still-required `categoryIds` field
 * truthful for a web deploy that has not learned about `tiles` yet.
 */
import {
  WATCH_HOME_CATEGORY_BY_ID,
  isSafeWatchHomeTileHref,
} from "@forge/watch-url-policy/watch-home-tiles"

import { asArray, asRecord, asString, type BlockRecord } from "./block-helpers"

export type RailTile = {
  id: string
  categoryId?: string
  title?: string
  href?: string
  icon?: string
  style?: string
}

const CATEGORY_TILE_ID_PREFIX = "category:"
const CUSTOM_TILE_ID_PREFIX = "custom-"

export function categoryTileId(categoryId: string) {
  return `${CATEGORY_TILE_ID_PREFIX}${categoryId}`
}

/**
 * First unused `custom-<n>`. Deterministic on purpose: `crypto.randomUUID`
 * would make every editor test assert against a moving target, and the id
 * only has to be unique within one block.
 */
export function nextCustomTileId(tiles: readonly RailTile[]) {
  const taken = new Set(tiles.map((tile) => tile.id))
  let index = 1
  while (taken.has(`${CUSTOM_TILE_ID_PREFIX}${index}`)) index += 1
  return `${CUSTOM_TILE_ID_PREFIX}${index}`
}

function optionalString(value: unknown) {
  const text = asString(value).trim()
  return text.length > 0 ? text : undefined
}

/**
 * Tiles derived from the legacy `categoryIds` shape. Every field beyond the
 * category reference stays unset so the renderer keeps applying catalog
 * defaults — converting a stored selection into tiles must not silently
 * freeze today's copy and colours into the block.
 */
function tilesFromCategoryIds(categoryIds: readonly unknown[]): RailTile[] {
  const seen = new Set<string>()
  const tiles: RailTile[] = []

  for (const value of categoryIds) {
    const categoryId = asString(value)
    if (!WATCH_HOME_CATEGORY_BY_ID.has(categoryId)) continue
    if (seen.has(categoryId)) continue
    seen.add(categoryId)
    tiles.push({ id: categoryTileId(categoryId), categoryId })
  }

  return tiles
}

function tileFromRecord(value: unknown, index: number): RailTile | null {
  const record = asRecord(value)
  if (!record) return null

  const categoryId = optionalString(record.categoryId)
  // An unknown categoryId means the catalog dropped that category. Keeping
  // the tile as a headless category reference would render nothing, so treat
  // the reference as absent and let the custom-tile rules decide.
  const knownCategoryId =
    categoryId != null && WATCH_HOME_CATEGORY_BY_ID.has(categoryId)
      ? categoryId
      : undefined

  return {
    id: optionalString(record.id) ?? `${CUSTOM_TILE_ID_PREFIX}r${index}`,
    categoryId: knownCategoryId,
    title: optionalString(record.title),
    href: optionalString(record.href),
    icon: optionalString(record.icon),
    style: optionalString(record.style),
  }
}

/** Duplicate ids and duplicate category references are both rejected on write. */
function dropDuplicates(tiles: readonly RailTile[]): RailTile[] {
  const seenIds = new Set<string>()
  const seenCategoryIds = new Set<string>()
  const kept: RailTile[] = []

  for (const tile of tiles) {
    if (seenIds.has(tile.id)) continue
    if (tile.categoryId != null && seenCategoryIds.has(tile.categoryId)) {
      continue
    }
    seenIds.add(tile.id)
    if (tile.categoryId != null) seenCategoryIds.add(tile.categoryId)
    kept.push(tile)
  }

  return kept
}

export function readRailTiles(block: BlockRecord | null | undefined) {
  const rawTiles = asArray(block?.tiles)
  if (rawTiles.length > 0) {
    const tiles = rawTiles
      .map((value, index) => tileFromRecord(value, index))
      .filter((tile): tile is RailTile => tile !== null)
    return dropDuplicates(tiles)
  }

  return tilesFromCategoryIds(asArray(block?.categoryIds))
}

/**
 * The `categoryIds` mirror. Only predefined tiles have a category to mirror,
 * so a rail of purely custom tiles mirrors to an empty array — which the
 * persistence schema rejects. The editor therefore falls back to the block's
 * previous mirror in that case (see `railBlockPatch`), because the mirror
 * exists for old readers and must never be the reason a save fails.
 */
export function categoryIdsFromTiles(tiles: readonly RailTile[]) {
  const categoryIds: string[] = []
  for (const tile of tiles) {
    if (tile.categoryId == null) continue
    if (categoryIds.includes(tile.categoryId)) continue
    categoryIds.push(tile.categoryId)
  }
  return categoryIds
}

/**
 * Strips absent optional fields so the `.strict()` block schema stays happy,
 * and canonicalizes whitespace. The editor stores field values as typed (a
 * controlled input cannot be trimmed on every keystroke without eating the
 * spaces the operator is typing), so this is the one place the persisted
 * shape is decided — a field that is only whitespace is an absent override,
 * not an empty string.
 */
function serializeTile(tile: RailTile) {
  const serialized: Record<string, unknown> = { id: tile.id.trim() }
  if (tile.categoryId != null) serialized.categoryId = tile.categoryId
  for (const key of ["title", "href", "icon", "style"] as const) {
    const value = tile[key]?.trim()
    if (value != null && value.length > 0) serialized[key] = value
  }
  return serialized
}

export function railBlockPatch(
  currentBlock: BlockRecord,
  tiles: readonly RailTile[],
) {
  const categoryIds = categoryIdsFromTiles(tiles)
  const previousCategoryIds = asArray(currentBlock.categoryIds)
    .map(asString)
    .filter((id) => WATCH_HOME_CATEGORY_BY_ID.has(id))

  return {
    ...currentBlock,
    // A rail with no predefined tile left still has to satisfy the required,
    // min(1) `categoryIds` field. Keeping the previous mirror is the least
    // wrong answer: the authoritative `tiles` array is what any current
    // reader uses, and an old reader keeps rendering what it rendered before.
    categoryIds:
      categoryIds.length > 0
        ? categoryIds
        : previousCategoryIds.length > 0
          ? previousCategoryIds
          : [...WATCH_HOME_CATEGORY_BY_ID.keys()].slice(0, 1),
    tiles: tiles.map(serializeTile),
  }
}

export type RailTileProblem = "title" | "href"

/**
 * What the editor shows inline. Mirrors the persistence schema's rules for
 * this tile so an admin sees the problem while typing instead of at save.
 *
 * Evaluated against the SERIALIZED view, not the as-typed one: a field
 * holding only whitespace is about to be persisted as absent, so it must
 * read as absent here too.
 */
export function railTileProblems(tile: RailTile): RailTileProblem[] {
  const problems: RailTileProblem[] = []
  const title = tile.title?.trim() || undefined
  const href = tile.href?.trim() || undefined

  if (tile.categoryId == null && title == null) problems.push("title")
  if (href == null) {
    if (tile.categoryId == null) problems.push("href")
  } else if (!isSafeWatchHomeTileHref(href)) {
    problems.push("href")
  }
  return problems
}
