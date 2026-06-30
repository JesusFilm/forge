export type MuxStoryboardTile = {
  start: number
  x: number
  y: number
}

export type MuxStoryboard = {
  duration: number
  tileHeight: number
  tileWidth: number
  tiles: MuxStoryboardTile[]
  url: string
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

export function buildMuxStoryboardJsonUrl(playbackId: string): string {
  return `https://image.mux.com/${encodeURIComponent(
    playbackId,
  )}/storyboard.json?format=webp`
}

export function parseMuxStoryboard(value: unknown): MuxStoryboard | null {
  if (!isRecord(value)) return null

  const url = value.url
  const tileWidth = value.tile_width
  const tileHeight = value.tile_height
  const duration = value.duration
  const rawTiles = value.tiles

  if (typeof url !== "string" || url.length === 0) return null
  if (!isPositiveFiniteNumber(tileWidth)) return null
  if (!isPositiveFiniteNumber(tileHeight)) return null
  if (!isPositiveFiniteNumber(duration)) return null
  if (!Array.isArray(rawTiles) || rawTiles.length === 0) return null

  const tiles: MuxStoryboardTile[] = []
  for (const rawTile of rawTiles) {
    if (!isRecord(rawTile)) return null
    const { start, x, y } = rawTile
    if (!isFiniteNumber(start)) return null
    if (!isFiniteNumber(x)) return null
    if (!isFiniteNumber(y)) return null
    tiles.push({ start, x, y })
  }

  return {
    duration,
    tileHeight,
    tileWidth,
    tiles,
    url,
  }
}

export function findStoryboardTile(
  storyboard: MuxStoryboard,
  timeSeconds: number,
): MuxStoryboardTile | null {
  if (!Number.isFinite(timeSeconds)) return null

  let selected = storyboard.tiles[0] ?? null
  for (const tile of storyboard.tiles) {
    if (tile.start > timeSeconds) break
    selected = tile
  }
  return selected
}
