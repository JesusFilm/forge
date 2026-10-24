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

export type SeekDirection = "forward" | "backward"

const PLAYBACK_ID = /^[A-Za-z0-9_-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

export function buildMuxStoryboardUrl(
  playbackId: string,
  format: "jpg" | "webp" = "webp",
): string | null {
  return PLAYBACK_ID.test(playbackId)
    ? `https://image.mux.com/${playbackId}/storyboard.json?format=${format}`
    : null
}

export function parseMuxStoryboard(value: unknown): MuxStoryboard | null {
  if (!isRecord(value)) return null
  const { url, tile_width, tile_height, duration, tiles } = value
  if (typeof url !== "string") return null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return null
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "image.mux.com"
  ) {
    return null
  }
  if (!isPositiveNumber(tile_width)) return null
  if (!isPositiveNumber(tile_height)) return null
  if (!isPositiveNumber(duration)) return null
  if (!Array.isArray(tiles) || tiles.length === 0) return null

  const parsedTiles: MuxStoryboardTile[] = []
  for (const tile of tiles) {
    if (!isRecord(tile)) return null
    if (!isFiniteNumber(tile.start)) return null
    if (!isFiniteNumber(tile.x) || !isFiniteNumber(tile.y)) return null
    parsedTiles.push({ start: tile.start, x: tile.x, y: tile.y })
  }

  return {
    url,
    tileWidth: tile_width,
    tileHeight: tile_height,
    duration,
    tiles: parsedTiles,
  }
}

export function findStoryboardTileIndex(
  storyboard: MuxStoryboard,
  timeSeconds: number,
): number {
  if (!Number.isFinite(timeSeconds)) return 0
  let selected = 0
  for (let index = 0; index < storyboard.tiles.length; index += 1) {
    if (storyboard.tiles[index].start > timeSeconds) break
    selected = index
  }
  return selected
}

export function getStoryboardWindow(
  storyboard: MuxStoryboard,
  timeSeconds: number,
  count = 7,
): { tiles: MuxStoryboardTile[]; selectedIndex: number } {
  const selected = findStoryboardTileIndex(storyboard, timeSeconds)
  const half = Math.floor(count / 2)
  const maxStart = Math.max(0, storyboard.tiles.length - count)
  const start = Math.min(maxStart, Math.max(0, selected - half))
  return {
    tiles: storyboard.tiles.slice(start, start + count),
    selectedIndex: selected - start,
  }
}

export function scrubTimeFromPan({
  originTime,
  translationX,
  duration,
}: {
  originTime: number
  translationX: number
  duration: number
}): number {
  if (!Number.isFinite(duration) || duration <= 0) return originTime
  const maxTravelSeconds = Math.min(duration * 0.25, 30 * 60)
  const deltaSeconds = (translationX / 900) * maxTravelSeconds
  return Math.min(duration - 0.5, Math.max(0, originTime + deltaSeconds))
}

export function nextScrubOrigin(
  previewTime: number | null,
  currentTime: number,
): number {
  return previewTime != null && Number.isFinite(previewTime)
    ? previewTime
    : currentTime
}

export function seekDirection(
  originTime: number,
  targetTime: number,
): SeekDirection {
  return targetTime < originTime ? "backward" : "forward"
}

export function hasSeekReachedTarget({
  currentTime,
  targetTime,
  direction,
  tolerance = 0.5,
}: {
  currentTime: number
  targetTime: number
  direction: SeekDirection
  tolerance?: number
}): boolean {
  if (Math.abs(currentTime - targetTime) <= tolerance) return true
  return direction === "forward"
    ? currentTime > targetTime
    : currentTime < targetTime
}

export function timelinePositions({
  currentTime,
  previewTime,
  duration,
}: {
  currentTime: number
  previewTime: number | null
  duration: number
}): { committedPct: number; previewPct: number } {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { committedPct: 0, previewPct: 0 }
  }
  const percent = (time: number) =>
    Math.min(100, Math.max(0, (time / duration) * 100))
  return {
    committedPct: percent(currentTime),
    previewPct: percent(previewTime ?? currentTime),
  }
}
