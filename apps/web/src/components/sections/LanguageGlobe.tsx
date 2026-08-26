"use client"

import { useEffect, useId, useRef, type CSSProperties } from "react"
import { cn } from "@/lib/utils"
import { LAND_COORDINATES } from "./languageGlobeLand"
import { VERSE_REFERENCE, VERSE_TRANSLATIONS } from "./languageGlobeVerse"

type GeographicPoint = {
  latitude: number
  longitude: number
}

type LanguagePoint = GeographicPoint & {
  label: string
}

type ProjectedLanguage = LanguagePoint & {
  depth: number
  x: number
  y: number
}

type DrawableLanguage = {
  latitudeScale: number
  x: number
  y: number
  z: number
}

type IslandDetail = GeographicPoint & {
  mark: string
  scale: number
}

type DrawableIslandDetail = DrawableLanguage & {
  mark: string
  scale: number
}

type BackgroundStar = {
  angle: number
  distance: number
}

type LanguageGlobeProps = {
  className?: string
  layout?: "embedded" | "standalone"
  rotationSeconds?: number
  initialRotationDegrees?: number
}

type AnimationConditions = {
  pageLoaded: boolean
  inViewport: boolean
  documentVisible: boolean
  reducedMotion: boolean
}

type LanguageGlobeRenderProfile = {
  atmosphereStride: number
  coastStride: number
  compactLand: boolean
  densityCap: number
  frameIntervalMilliseconds: number
  landCellScale: number
  starStride: number
}

const TAU = Math.PI * 2
const DEGREES_TO_RADIANS = Math.PI / 180
const GLOBE_VISUAL_SCALE = 0.8
const LAND_GRID_RADIANS = 1.5 * DEGREES_TO_RADIANS
const MAX_CANVAS_DENSITY = 1.5
const MONOSPACE_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
const ENGLISH_VERSE = VERSE_TRANSLATIONS.find(({ id }) => id === "engwebp")
const DISPLAY_TRANSLATIONS = ENGLISH_VERSE
  ? [
      ENGLISH_VERSE,
      ...VERSE_TRANSLATIONS.filter(({ id }) => id !== ENGLISH_VERSE.id),
    ]
  : VERSE_TRANSLATIONS
const TEXTURE_TRANSLATIONS = DISPLAY_TRANSLATIONS.map((translation) => {
  const repeatedText = `${translation.text}   `
  return {
    ...translation,
    glyphCount: Array.from(repeatedText).length,
    repeatedText,
  }
})
const CAPTION_DURATION_MS = 5000
const COAST_MARKS = ["·", ":", "'", ";", "°"] as const
const ATMOSPHERE_MARKS = ["·", ":", "'", "°", "~", "·"] as const
const ATMOSPHERE_MARK_COUNT = 44
const VERSE_LINE_CACHE = new Map<string, readonly string[]>()
const BACKGROUND_STAR_LAYERS = [
  {
    opacity: 0.18,
    phase: 0.4,
    size: 0.8,
    speed: 0.00045,
    stars: [] as BackgroundStar[],
  },
  {
    opacity: 0.28,
    phase: 2.1,
    size: 1,
    speed: 0.00034,
    stars: [] as BackgroundStar[],
  },
  {
    opacity: 0.4,
    phase: 4.3,
    size: 1.25,
    speed: 0.00027,
    stars: [] as BackgroundStar[],
  },
] as const
const BACKGROUND_STAR_ACCENTS = [
  { angle: 3.38, distance: 1.1, mark: "+", phase: 0.2 },
  { angle: 3.82, distance: 1.17, mark: "·", phase: 1.4 },
  { angle: 4.25, distance: 1.08, mark: "✦", phase: 2.5 },
  { angle: 4.78, distance: 1.16, mark: "+", phase: 3.1 },
  { angle: 5.25, distance: 1.09, mark: "·", phase: 4.2 },
  { angle: 5.78, distance: 1.18, mark: "✦", phase: 5.3 },
] as const

for (let index = 0; index < 42; index += 1) {
  BACKGROUND_STAR_LAYERS[index % BACKGROUND_STAR_LAYERS.length].stars.push({
    angle:
      Math.PI +
      (((index * 83 + index * index * 17 + 41) % 997) / 997) * Math.PI,
    distance:
      1.035 + (((index * 191 + index * index * 23 + 73) % 991) / 991) * 0.19,
  })
}

export function starShimmerOpacity(
  elapsedMilliseconds: number,
  maximumOpacity: number,
  phase: number,
  speed: number,
) {
  return (
    maximumOpacity *
    (0.55 + 0.45 * Math.sin(elapsedMilliseconds * speed + phase))
  )
}

export function advanceFrameSchedule(
  previousFrame: number,
  now: number,
  frameIntervalMilliseconds: number,
): number {
  const elapsed = now - previousFrame
  return now - (elapsed % frameIntervalMilliseconds)
}

export function getLanguageGlobeRenderProfile(
  canvasWidth: number,
  hardwareConcurrency = 8,
  deviceMemory = 8,
): LanguageGlobeRenderProfile {
  const constrainedDevice = hardwareConcurrency <= 4 || deviceMemory <= 4
  const severelyConstrained =
    hardwareConcurrency <= 2 ||
    deviceMemory <= 2 ||
    (canvasWidth < 430 && constrainedDevice)

  if (severelyConstrained) {
    return {
      atmosphereStride: 2,
      coastStride: 3,
      compactLand: true,
      densityCap: 1,
      frameIntervalMilliseconds: 1000 / 16,
      landCellScale: 2.08,
      starStride: 2,
    }
  }

  if (canvasWidth < 600 || constrainedDevice) {
    return {
      atmosphereStride: 2,
      coastStride: 2,
      compactLand: true,
      densityCap: 1.25,
      frameIntervalMilliseconds: 1000 / 20,
      landCellScale: 2.08,
      starStride: 1,
    }
  }

  return {
    atmosphereStride: 1,
    coastStride: 1,
    compactLand: false,
    densityCap: MAX_CANVAS_DENSITY,
    frameIntervalMilliseconds: 1000 / 24,
    landCellScale: 1,
    starStride: 1,
  }
}

// Small islands and archipelagos that disappear when Natural Earth's land
// polygons are sampled onto the compact 1.5-degree runtime grid.
const SMALL_ISLAND_DETAILS: readonly IslandDetail[] = [
  { latitude: 52, longitude: -172, mark: "·", scale: 0.8 }, // Aleutians
  { latitude: 53, longitude: -166, mark: ":", scale: 0.85 },
  { latitude: 21, longitude: -157, mark: "⁕", scale: 1.15 }, // Hawaii
  { latitude: 19.6, longitude: -155.5, mark: "·", scale: 0.9 },
  { latitude: 32.3, longitude: -64.8, mark: "°", scale: 0.9 }, // Bermuda
  { latitude: 25.1, longitude: -77.3, mark: ":", scale: 1 }, // Bahamas
  { latitude: 19.3, longitude: -81.3, mark: "·", scale: 0.75 }, // Cayman
  { latitude: 18.2, longitude: -66.5, mark: ";", scale: 0.9 }, // Puerto Rico
  { latitude: 17.3, longitude: -62.8, mark: "'", scale: 0.75 },
  { latitude: 15.4, longitude: -61.3, mark: ":", scale: 0.8 },
  { latitude: 13.2, longitude: -61.2, mark: "·", scale: 0.75 },
  { latitude: 12.1, longitude: -61.7, mark: "'", scale: 0.7 },
  { latitude: -0.7, longitude: -90.5, mark: "⁕", scale: 1 }, // Galápagos
  { latitude: 38.5, longitude: -28, mark: ":", scale: 0.9 }, // Azores
  { latitude: 32.7, longitude: -16.9, mark: "°", scale: 0.85 }, // Madeira
  { latitude: 28.3, longitude: -16.5, mark: ";", scale: 0.9 }, // Canaries
  { latitude: 16, longitude: -24, mark: ":", scale: 0.85 }, // Cape Verde
  { latitude: 62, longitude: -6.8, mark: "⁕", scale: 0.9 }, // Faroe
  { latitude: 78, longitude: 16, mark: ":", scale: 1 }, // Svalbard
  { latitude: 39.6, longitude: 2.8, mark: "·", scale: 0.85 }, // Balearics
  { latitude: 42.2, longitude: 9.1, mark: ";", scale: 0.9 }, // Corsica
  { latitude: 40, longitude: 9, mark: ":", scale: 1 }, // Sardinia
  { latitude: 37.6, longitude: 14, mark: "⁕", scale: 1 }, // Sicily
  { latitude: 35.9, longitude: 14.4, mark: "·", scale: 0.75 }, // Malta
  { latitude: 35.2, longitude: 24.9, mark: "—", scale: 1 }, // Crete
  { latitude: 35.1, longitude: 33.2, mark: ";", scale: 0.9 }, // Cyprus
  { latitude: 12.5, longitude: 53.9, mark: "⁕", scale: 0.9 }, // Socotra
  { latitude: 4.2, longitude: 73.5, mark: ":", scale: 0.8 }, // Maldives
  { latitude: 7.8, longitude: 80.7, mark: "'", scale: 1 }, // Sri Lanka
  { latitude: 11.7, longitude: 92.7, mark: ";", scale: 0.9 }, // Andaman
  { latitude: 23.7, longitude: 121, mark: "⁕", scale: 1 }, // Taiwan
  { latitude: 26.3, longitude: 127.8, mark: "·", scale: 0.75 }, // Okinawa
  { latitude: 18.8, longitude: 121, mark: "'", scale: 0.8 }, // Philippines
  { latitude: 13, longitude: 122, mark: ":", scale: 1 },
  { latitude: 9.7, longitude: 123, mark: ";", scale: 0.85 },
  { latitude: 13.4, longitude: 144.8, mark: "⁕", scale: 0.8 }, // Guam
  { latitude: 7.5, longitude: 134.5, mark: "·", scale: 0.75 }, // Palau
  { latitude: 7.4, longitude: 151.8, mark: ":", scale: 0.8 }, // Micronesia
  { latitude: 7.1, longitude: 171.2, mark: ";", scale: 0.8 }, // Marshalls
]

export function wrapVerseText(text: string, maximumCharacters: number) {
  if (!/\s/u.test(text)) {
    const characters = Array.from(text)
    const lines: string[] = []
    for (let index = 0; index < characters.length; index += maximumCharacters) {
      lines.push(characters.slice(index, index + maximumCharacters).join(""))
    }
    return lines
  }

  const lines: string[] = []
  let line = ""

  for (const word of text.split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maximumCharacters || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }

  if (line) lines.push(line)
  return lines
}

function cachedVerseLines(
  translationId: string,
  text: string,
  maximumCharacters: number,
) {
  const cacheKey = `${translationId}:${maximumCharacters}`
  const cached = VERSE_LINE_CACHE.get(cacheKey)
  if (cached) return cached

  const lines = wrapVerseText(text, maximumCharacters)
  VERSE_LINE_CACHE.set(cacheKey, lines)
  return lines
}

const LAND_CELLS: GeographicPoint[] = []
for (
  let coordinateIndex = 0;
  coordinateIndex < LAND_COORDINATES.length;
  coordinateIndex += 2
) {
  const latitudeTwice = LAND_COORDINATES[coordinateIndex]
  if (latitudeTwice < -6) continue

  const longitudeTwice = LAND_COORDINATES[coordinateIndex + 1]

  LAND_CELLS.push({
    latitude: latitudeTwice / 2,
    longitude: longitudeTwice / 2,
  })
}

const LAND_COORDINATE_KEYS = new Set<number>()
for (let index = 0; index < LAND_COORDINATES.length; index += 2) {
  LAND_COORDINATE_KEYS.add(
    (LAND_COORDINATES[index] + 128) * 1024 + LAND_COORDINATES[index + 1] + 512,
  )
}

const COAST_DETAIL_CELLS: IslandDetail[] = []
for (let cellIndex = 0; cellIndex < LAND_CELLS.length; cellIndex += 1) {
  if (cellIndex % 3 !== 0) continue

  const point = LAND_CELLS[cellIndex]
  const latitudeTwice = Math.round(point.latitude * 2)
  const longitudeTwice = Math.round(point.longitude * 2)
  const neighboringCoordinates = [
    [latitudeTwice - 3, longitudeTwice],
    [latitudeTwice + 3, longitudeTwice],
    [latitudeTwice, longitudeTwice - 3],
    [latitudeTwice, longitudeTwice + 3],
  ]
  const isCoast = neighboringCoordinates.some(
    ([latitude, longitude]) =>
      !LAND_COORDINATE_KEYS.has((latitude + 128) * 1024 + longitude + 512),
  )

  if (isCoast) {
    COAST_DETAIL_CELLS.push({
      ...point,
      mark: COAST_MARKS[cellIndex % COAST_MARKS.length],
      scale: 1,
    })
  }
}

function nearestGridValue(valueTwice: number, start: number) {
  return start + Math.round((valueTwice - start) / 3) * 3
}

export function isLandCoordinate(latitude: number, longitude: number) {
  const wrappedLongitude = ((((longitude + 180) % 360) + 360) % 360) - 180
  const latitudeTwice = nearestGridValue(latitude * 2, -120)
  const longitudeTwice = nearestGridValue(wrappedLongitude * 2, -357)

  return LAND_COORDINATE_KEYS.has(
    (latitudeTwice + 128) * 1024 + longitudeTwice + 512,
  )
}

function prepareDrawableLanguage(point: GeographicPoint): DrawableLanguage {
  const latitude = point.latitude * DEGREES_TO_RADIANS
  const longitude = point.longitude * DEGREES_TO_RADIANS
  const latitudeRadius = Math.cos(latitude)

  return {
    latitudeScale: Math.max(0.2, latitudeRadius),
    x: latitudeRadius * Math.sin(longitude),
    y: -Math.sin(latitude),
    z: latitudeRadius * Math.cos(longitude),
  }
}

// Geographic projection is cached once. Animation frames only rotate these
// Cartesian points using one sine/cosine pair for the whole globe.
const LAND_DRAW_CELLS = LAND_CELLS.map(prepareDrawableLanguage)
const COMPACT_LAND_DRAW_CELLS = LAND_CELLS.filter((point) => {
  const latitudeTwice = Math.round(point.latitude * 2)
  const longitudeTwice = Math.round(point.longitude * 2)
  return (latitudeTwice + 120) % 6 === 0 && (longitudeTwice + 357) % 6 === 0
}).map(prepareDrawableLanguage)
const COAST_DRAW_CELLS = COAST_DETAIL_CELLS.map(
  (point): DrawableIslandDetail => ({
    ...prepareDrawableLanguage(point),
    mark: point.mark,
    scale: point.scale,
  }),
)
const ISLAND_DRAW_DETAILS = SMALL_ISLAND_DETAILS.map(
  (point): DrawableIslandDetail => ({
    ...prepareDrawableLanguage(point),
    mark: point.mark,
    scale: point.scale,
  }),
)

export function hasSmallIslandDetailNear(
  latitude: number,
  longitude: number,
  tolerance = 1,
) {
  return SMALL_ISLAND_DETAILS.some(
    (point) =>
      Math.abs(point.latitude - latitude) <= tolerance &&
      Math.abs(point.longitude - longitude) <= tolerance,
  )
}

export function projectLanguagePoint(
  point: LanguagePoint,
  rotationRadians: number,
): ProjectedLanguage {
  const latitude = point.latitude * DEGREES_TO_RADIANS
  const longitude = point.longitude * DEGREES_TO_RADIANS + rotationRadians
  const latitudeRadius = Math.cos(latitude)

  return {
    ...point,
    x: latitudeRadius * Math.sin(longitude),
    y: -Math.sin(latitude),
    depth: latitudeRadius * Math.cos(longitude),
  }
}

export function shouldAnimateLanguageGlobe({
  pageLoaded,
  inViewport,
  documentVisible,
  reducedMotion,
}: AnimationConditions): boolean {
  return pageLoaded && inViewport && documentVisible && !reducedMotion
}

function drawGlobe(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  rotationRadians: number,
  elapsedMilliseconds: number,
  renderProfile: LanguageGlobeRenderProfile,
) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const density = Math.min(
    window.devicePixelRatio || 1,
    renderProfile.densityCap,
  )
  const pixelWidth = Math.max(1, Math.round(width * density))
  const pixelHeight = Math.max(1, Math.round(height * density))

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }

  context.setTransform(density, 0, 0, density, 0, 0)
  context.fillStyle = "#09090b"
  context.fillRect(0, 0, width, height)

  const radius =
    Math.min(Math.max(width * 0.62, height * 0.72), 720) * GLOBE_VISUAL_SCALE
  const horizontalRadius = radius * 1.08
  const centerX = width * 0.515
  const centerY = height * 0.98
  const horizontalCellFactor = horizontalRadius * LAND_GRID_RADIANS * 1.18
  const verticalCellFactor = radius * LAND_GRID_RADIANS * 1.18

  // Stars follow a narrow halo outside the globe's top rim. Three asynchronously
  // shimmering opacity layers keep the effect organic while retaining batched
  // drawing and the existing single animation loop.
  for (const layer of BACKGROUND_STAR_LAYERS) {
    const opacity = starShimmerOpacity(
      elapsedMilliseconds,
      layer.opacity,
      layer.phase,
      layer.speed,
    )
    context.fillStyle = `rgba(255, 255, 255, ${opacity})`
    for (
      let starIndex = 0;
      starIndex < layer.stars.length;
      starIndex += renderProfile.starStride
    ) {
      const star = layer.stars[starIndex]
      const screenX =
        centerX + Math.cos(star.angle) * horizontalRadius * star.distance
      const screenY = centerY + Math.sin(star.angle) * radius * star.distance
      if (screenX < 0 || screenX > width || screenY < 0 || screenY > height)
        continue
      context.fillRect(
        Math.round(screenX),
        Math.round(screenY),
        layer.size,
        layer.size,
      )
    }
  }
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.font = `500 ${width < 560 ? 7 : 9}px ${MONOSPACE_FONT}`
  for (const star of BACKGROUND_STAR_ACCENTS) {
    const opacity = starShimmerOpacity(
      elapsedMilliseconds,
      0.42,
      star.phase,
      0.00038,
    )
    const screenX =
      centerX + Math.cos(star.angle) * horizontalRadius * star.distance
    const screenY = centerY + Math.sin(star.angle) * radius * star.distance
    if (screenX < 0 || screenX > width || screenY < 0 || screenY > height)
      continue
    context.fillStyle = `rgba(255, 255, 255, ${opacity})`
    context.fillText(star.mark, screenX, screenY)
  }

  // A punctuation-like atmospheric rim makes the round silhouette legible
  // without introducing a solid geometric border.
  context.save()
  context.beginPath()
  context.ellipse(
    centerX,
    centerY,
    horizontalRadius * 1.012,
    radius * 1.012,
    0,
    Math.PI,
    TAU,
  )
  context.setLineDash([1, 10, 2, 14, 1, 18])
  context.lineCap = "round"
  context.lineWidth = width < 560 ? 0.65 : 0.8
  context.strokeStyle = "rgba(255, 255, 255, 0.16)"
  context.stroke()

  context.setLineDash([])
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.font = `500 ${width < 560 ? 7 : 8}px ${MONOSPACE_FONT}`
  context.fillStyle = "rgba(255, 255, 255, 0.23)"
  for (
    let index = 0;
    index < ATMOSPHERE_MARK_COUNT;
    index += renderProfile.atmosphereStride
  ) {
    const progress = index / (ATMOSPHERE_MARK_COUNT - 1)
    const angle = Math.PI + progress * Math.PI
    const distance = 1.014 + (index % 3) * 0.002
    const screenX = centerX + Math.cos(angle) * horizontalRadius * distance
    const screenY = centerY + Math.sin(angle) * radius * distance
    if (screenX < 0 || screenX > width || screenY < 0 || screenY > height)
      continue
    context.fillText(
      ATMOSPHERE_MARKS[index % ATMOSPHERE_MARKS.length],
      screenX,
      screenY,
    )
  }
  context.restore()

  const sine = Math.sin(rotationRadians)
  const cosine = Math.cos(rotationRadians)

  // Build one geographic clip path, then draw each verse line once. This keeps
  // letters crisp: perspective changes the continent mask instead of squeezing
  // thousands of separate text fragments into overlapping screen positions.
  context.save()
  context.beginPath()
  const landDrawCells = renderProfile.compactLand
    ? COMPACT_LAND_DRAW_CELLS
    : LAND_DRAW_CELLS
  for (const point of landDrawCells) {
    const depth = point.z * cosine - point.x * sine
    if (depth < 0.08) continue

    const screenY = centerY + point.y * radius
    if (screenY < -20 || screenY > height + 20) continue

    const x = point.x * cosine + point.z * sine
    const screenX = centerX + x * horizontalRadius
    if (screenX < -24 || screenX > width + 24) continue

    const cellWidth = Math.max(
      2.5,
      horizontalCellFactor * depth * renderProfile.landCellScale,
    )
    const cellHeight = Math.max(
      2.5,
      verticalCellFactor * point.latitudeScale * renderProfile.landCellScale,
    )
    context.rect(
      screenX - cellWidth / 2,
      screenY - cellHeight / 2,
      cellWidth,
      cellHeight,
    )
  }
  context.clip()

  const textureFontSize = width < 560 ? 10 : 12
  const textureLineHeight = textureFontSize * 1.42
  const firstTextureLine = Math.floor((centerY - radius) / textureLineHeight)
  const lastTextureLine = Math.ceil(height / textureLineHeight)
  context.textBaseline = "top"
  context.font = `500 ${textureFontSize}px ${MONOSPACE_FONT}`
  context.fillStyle = "rgba(244, 244, 245, 0.82)"

  for (let row = firstTextureLine; row <= lastTextureLine; row += 1) {
    const translation =
      TEXTURE_TRANSLATIONS[
        ((row % TEXTURE_TRANSLATIONS.length) + TEXTURE_TRANSLATIONS.length) %
          TEXTURE_TRANSLATIONS.length
      ]
    const estimatedWidth = Math.max(
      textureFontSize * 12,
      translation.glyphCount * textureFontSize * 0.61,
    )
    const travel =
      ((rotationRadians / TAU) * estimatedWidth + row * textureFontSize * 3.7) %
      estimatedWidth

    context.direction = translation.direction
    context.textAlign = "left"
    for (let lineX = -travel - estimatedWidth; lineX < width; ) {
      context.fillText(translation.repeatedText, lineX, row * textureLineHeight)
      lineX += estimatedWidth
    }
  }
  context.restore()

  // Punctuation restores fine coastline texture and makes sub-grid island
  // groups visible without adding another expensive land-text rendering pass.
  context.save()
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.direction = "inherit"
  context.font = `500 ${width < 560 ? 8 : 9}px ${MONOSPACE_FONT}`
  context.fillStyle = "rgba(244, 244, 245, 0.38)"
  for (
    let coastIndex = 0;
    coastIndex < COAST_DRAW_CELLS.length;
    coastIndex += renderProfile.coastStride
  ) {
    const point = COAST_DRAW_CELLS[coastIndex]
    const depth = point.z * cosine - point.x * sine
    if (depth < 0.2) continue

    const screenY = centerY + point.y * radius
    if (screenY < -10 || screenY > height + 10) continue
    const x = point.x * cosine + point.z * sine
    const screenX = centerX + x * horizontalRadius
    if (screenX < -10 || screenX > width + 10) continue

    context.fillText(point.mark, screenX, screenY)
  }

  context.fillStyle = "rgba(255, 255, 255, 0.72)"
  let islandFontSize = 0
  for (const point of ISLAND_DRAW_DETAILS) {
    const depth = point.z * cosine - point.x * sine
    if (depth < 0.12) continue

    const screenY = centerY + point.y * radius
    if (screenY < -12 || screenY > height + 12) continue
    const x = point.x * cosine + point.z * sine
    const screenX = centerX + x * horizontalRadius
    if (screenX < -12 || screenX > width + 12) continue

    const nextFontSize = (width < 560 ? 8 : 10) * point.scale
    if (nextFontSize !== islandFontSize) {
      islandFontSize = nextFontSize
      context.font = `600 ${islandFontSize}px ${MONOSPACE_FONT}`
    }
    context.fillText(point.mark, screenX, screenY)
  }
  context.restore()

  // Keep one complete translation readable in screen space at all times, then
  // cycle through the entire corpus. The Scripture never dissolves into the
  // land texture, and every included language gets equal prominence.
  const captionIndex =
    Math.floor(elapsedMilliseconds / CAPTION_DURATION_MS) %
    DISPLAY_TRANSLATIONS.length
  const captionTranslation = DISPLAY_TRANSLATIONS[captionIndex]
  if (captionTranslation) {
    const captionInset = Math.max(24, Math.min(64, width * 0.055))
    const captionY = Math.max(38, Math.min(58, height * 0.075))
    const captionWidth = Math.min(width - captionInset * 2, 680)
    const verseFontSize = width < 560 ? 11 : 14
    const maximumCharacters = Math.max(
      22,
      Math.floor(captionWidth / (verseFontSize * 0.61)),
    )
    const lines = cachedVerseLines(
      captionTranslation.id,
      captionTranslation.text,
      maximumCharacters,
    )
    const isRightToLeft = captionTranslation.direction === "rtl"
    const captionX = isRightToLeft ? width - captionInset : captionInset

    context.fillStyle = "#09090b"
    context.fillRect(
      captionInset - 10,
      captionY - 10,
      width - captionInset * 2 + 20,
      34 + lines.length * verseFontSize * 1.55,
    )

    context.direction = captionTranslation.direction
    context.textAlign = isRightToLeft ? "right" : "left"
    context.textBaseline = "top"
    context.font = `600 10px ${MONOSPACE_FONT}`
    context.fillStyle = "rgba(255, 255, 255, 0.52)"
    context.fillText(
      `${VERSE_REFERENCE.toUpperCase()} · ${captionTranslation.language.toUpperCase()} · ${String(
        captionIndex + 1,
      ).padStart(2, "0")} / ${DISPLAY_TRANSLATIONS.length}`,
      captionX,
      captionY,
    )

    context.font = `500 ${verseFontSize}px ${MONOSPACE_FONT}`
    context.fillStyle = "rgba(255, 255, 255, 0.94)"
    const lineHeight = verseFontSize * 1.55
    for (let index = 0; index < lines.length; index += 1) {
      context.fillText(
        lines[index],
        captionX,
        captionY + 24 + index * lineHeight,
      )
    }
    context.direction = "inherit"
  }
}

export function LanguageGlobe({
  className,
  layout = "standalone",
  rotationSeconds = 120,
  initialRotationDegrees = -12,
}: LanguageGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fallbackId = useId()
  const style = {
    "--language-globe-border": "rgba(255, 255, 255, 0.14)",
  } as CSSProperties

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d", { alpha: false })
    if (!canvas || !context) return

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let inViewport = false
    let documentVisible = document.visibilityState !== "hidden"
    let pageLoaded = document.readyState === "complete"
    let animationFrame = 0
    let animationTimer = 0
    let animating = false
    let previousFrame = 0
    let elapsedBeforePause = 0
    let resumedAt = performance.now()
    const initialRotation = initialRotationDegrees * DEGREES_TO_RADIANS
    const radiansPerMillisecond = TAU / (Math.max(8, rotationSeconds) * 1000)
    const deviceNavigator = navigator as Navigator & { deviceMemory?: number }
    const hardwareConcurrency = navigator.hardwareConcurrency || 8
    const deviceMemory = deviceNavigator.deviceMemory || 8
    let renderProfile = getLanguageGlobeRenderProfile(
      canvas.clientWidth,
      hardwareConcurrency,
      deviceMemory,
    )

    const currentElapsed = (now: number) =>
      elapsedBeforePause + (animating ? Math.max(0, now - resumedAt) : 0)

    const currentRotation = (now: number) =>
      initialRotation + currentElapsed(now) * radiansPerMillisecond

    const draw = (now = performance.now()) => {
      drawGlobe(
        canvas,
        context,
        currentRotation(now),
        currentElapsed(now),
        renderProfile,
      )
    }

    const scheduleFrame = (delay = 0) => {
      if (delay <= 0) {
        animationFrame = window.requestAnimationFrame(frame)
        return
      }
      animationTimer = window.setTimeout(() => {
        animationTimer = 0
        animationFrame = window.requestAnimationFrame(frame)
      }, delay)
    }

    const frame = (now: number) => {
      animationFrame = 0
      previousFrame = advanceFrameSchedule(
        previousFrame,
        now,
        renderProfile.frameIntervalMilliseconds,
      )
      draw(now)
      scheduleFrame(renderProfile.frameIntervalMilliseconds)
    }

    const cancelScheduledFrame = () => {
      window.cancelAnimationFrame(animationFrame)
      window.clearTimeout(animationTimer)
      animationFrame = 0
      animationTimer = 0
    }

    const shouldAnimate = () =>
      shouldAnimateLanguageGlobe({
        pageLoaded,
        inViewport,
        documentVisible,
        reducedMotion: reduceMotion.matches,
      })

    const syncAnimation = () => {
      const now = performance.now()
      if (animating) elapsedBeforePause += Math.max(0, now - resumedAt)
      cancelScheduledFrame()
      animating = false

      if (shouldAnimate()) {
        resumedAt = now
        animating = true
        scheduleFrame()
      } else if (inViewport && documentVisible && pageLoaded) {
        draw(now)
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      renderProfile = getLanguageGlobeRenderProfile(
        canvas.clientWidth,
        hardwareConcurrency,
        deviceMemory,
      )
      if (inViewport) draw()
    })
    resizeObserver.observe(canvas)

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry?.isIntersecting ?? true
        syncAnimation()
      },
      { rootMargin: "120px" },
    )
    intersectionObserver.observe(canvas)

    const handleVisibilityChange = () => {
      documentVisible = document.visibilityState !== "hidden"
      syncAnimation()
    }
    const handleLoad = () => {
      pageLoaded = true
      syncAnimation()
    }
    const handleMotionChange = () => syncAnimation()

    document.addEventListener("visibilitychange", handleVisibilityChange)
    reduceMotion.addEventListener("change", handleMotionChange)
    if (!pageLoaded) window.addEventListener("load", handleLoad, { once: true })

    syncAnimation()

    return () => {
      cancelScheduledFrame()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      reduceMotion.removeEventListener("change", handleMotionChange)
      window.removeEventListener("load", handleLoad)
    }
  }, [initialRotationDegrees, rotationSeconds])

  const canvas = (
    <canvas
      ref={canvasRef}
      data-testid="language-globe-canvas"
      className="block h-full w-full"
      role="img"
      aria-label={`A rotating globe formed from ${VERSE_REFERENCE} in ${VERSE_TRANSLATIONS.length} public-domain language editions`}
      aria-describedby={fallbackId}
    >
      {VERSE_REFERENCE}: {ENGLISH_VERSE?.text} Rendered in{" "}
      {VERSE_TRANSLATIONS.length} public-domain language editions.
    </canvas>
  )

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-[#09090b]",
        layout === "standalone"
          ? "h-[100svh] min-h-[32rem] px-[clamp(1rem,4.08vw,2.875rem)] pt-0 pb-[6px]"
          : "h-[clamp(31rem,70vw,54rem)]",
        className,
      )}
      style={style}
      aria-label={`${VERSE_REFERENCE} across the nations`}
    >
      <span id={fallbackId} className="sr-only">
        {VERSE_REFERENCE}: {ENGLISH_VERSE?.text} Rendered in{" "}
        {VERSE_TRANSLATIONS.length} public-domain language editions.
      </span>
      {layout === "standalone" ? (
        <div className="relative h-full w-full overflow-hidden rounded-[1.05rem] border border-[var(--language-globe-border)] bg-[#09090b]">
          {canvas}
        </div>
      ) : (
        canvas
      )}
    </div>
  )
}
