export type LanguageOrbitQuality = "auto" | "low" | "high"
export type ResolvedLanguageOrbitTier = "low" | "high"

export type LanguageOrbitQualitySettings = {
  tier: ResolvedLanguageOrbitTier
  dpr: number
  sphereSegments: number
  starCount: number
  textSize: number
  orbitScale: number
  twinkle: boolean
  frameloop: "always" | "demand"
}

export const ORBIT_PERFORMANCE_SAMPLE_FRAMES = 120
export const ORBIT_DOWNGRADE_P90_MS = 34

export function resolveLanguageOrbitQuality({
  quality,
  width,
  coarsePointer,
  devicePixelRatio,
  reducedMotion,
}: {
  quality: LanguageOrbitQuality
  width: number
  coarsePointer: boolean
  devicePixelRatio: number
  reducedMotion: boolean
}): LanguageOrbitQualitySettings {
  const tier = resolveTier({ quality, width, coarsePointer })
  const high = tier === "high"
  const dprCap = high ? 1.75 : 1.5

  return {
    tier,
    dpr: Math.min(Math.max(devicePixelRatio || 1, 1), dprCap),
    sphereSegments: high ? 72 : 40,
    starCount: high ? 900 : 360,
    textSize: high ? 0.36 : 0.25,
    orbitScale: high ? 1 : 0.78,
    twinkle: !reducedMotion,
    frameloop: reducedMotion ? "demand" : "always",
  }
}

function resolveTier({
  quality,
  width,
  coarsePointer,
}: {
  quality: LanguageOrbitQuality
  width: number
  coarsePointer: boolean
}): ResolvedLanguageOrbitTier {
  if (quality !== "auto") return quality
  return width < 640 || coarsePointer ? "low" : "high"
}

export function assessOrbitFramePerformance(
  frameTimesMs: readonly number[],
): "hold" | "downgrade" {
  if (frameTimesMs.length < ORBIT_PERFORMANCE_SAMPLE_FRAMES) return "hold"
  const window = [...frameTimesMs.slice(-ORBIT_PERFORMANCE_SAMPLE_FRAMES)].sort(
    (a, b) => a - b,
  )
  const percentileIndex = Math.ceil(window.length * 0.9) - 1
  return window[percentileIndex] >= ORBIT_DOWNGRADE_P90_MS
    ? "downgrade"
    : "hold"
}
