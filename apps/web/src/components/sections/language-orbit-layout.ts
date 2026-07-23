import type { LanguageGlobeEntry } from "./language-globe-model"
import { ARABIC_ORBIT_FONT, LATIN_ORBIT_FONT } from "./language-orbit-assets"

export const EARTH_RADIUS = 2.08
export const EARTH_CLOUD_RADIUS = 2.12
export const EARTH_ATMOSPHERE_RADIUS = 2.28
export const LANGUAGE_ORBIT_X_RADIUS = 3.55
export const LANGUAGE_ORBIT_Z_RADIUS = 3.15
export const LANGUAGE_ORBIT_Y_AMPLITUDE = 0.36

const ORBIT_COLOR_RAMP = [
  "#3b82f6",
  "#2563eb",
  "#22d3ee",
  "#14b8a6",
  "#2dd4bf",
  "#eab308",
  "#fbbf24",
] as const
const ARABIC_PATTERN = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/
const SUPPORTED_LATIN_PATTERN =
  /^[\u0020-\u007e\u00a0-\u024f\u1e00-\u1eff\u2000-\u206f]+$/u
const SUPPORTED_ARABIC_PATTERN =
  /^[\u0020-\u007e\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff\u2000-\u206f]+$/u

type OrbitTextDirection = "ltr" | "rtl"

type OrbitTypography = {
  label: string
  direction: OrbitTextDirection
  font: string
}

type LanguageOrbitPlacement = OrbitTypography & {
  id: string
  color: string
  position: readonly [number, number, number]
  separator: "" | " •"
}

export function resolveOrbitTypography(
  language: Pick<LanguageGlobeEntry, "nativeLabel" | "englishLabel">,
): OrbitTypography {
  const nativeLabel = language.nativeLabel.trim()
  const containsArabic = ARABIC_PATTERN.test(nativeLabel)
  if (containsArabic && SUPPORTED_ARABIC_PATTERN.test(nativeLabel)) {
    return {
      label: nativeLabel,
      direction: "rtl",
      font: ARABIC_ORBIT_FONT,
    }
  }
  if (nativeLabel.length > 0 && SUPPORTED_LATIN_PATTERN.test(nativeLabel)) {
    return {
      label: nativeLabel,
      direction: "ltr",
      font: LATIN_ORBIT_FONT,
    }
  }

  const conciseEnglishLabel =
    language.englishLabel.split(/[,(]/, 1)[0]?.trim() || "Language"
  return {
    label: conciseEnglishLabel,
    direction: "ltr",
    font: LATIN_ORBIT_FONT,
  }
}

export function buildLanguageOrbitLayout(
  languages: LanguageGlobeEntry[],
): LanguageOrbitPlacement[] {
  const count = languages.length
  if (count === 0) return []

  const typographies = languages.map(resolveOrbitTypography)
  const weights = typographies.map(({ label }) =>
    Math.max(4, Array.from(label).length + 2),
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let consumedWeight = 0

  return languages.map((language, index) => {
    const weight = weights[index]
    const angle =
      count === 1
        ? 0
        : ((consumedWeight + weight / 2) / totalWeight) * Math.PI * 2
    consumedWeight += weight
    const colorIndex =
      count === 1
        ? 0
        : Math.round((index / (count - 1)) * (ORBIT_COLOR_RAMP.length - 1))
    const typography = typographies[index]

    return {
      ...typography,
      id: language.id,
      color: ORBIT_COLOR_RAMP[colorIndex],
      position: [
        Math.cos(angle) * LANGUAGE_ORBIT_X_RADIUS,
        Math.sin(angle) * LANGUAGE_ORBIT_Y_AMPLITUDE,
        Math.sin(angle) * LANGUAGE_ORBIT_Z_RADIUS,
      ] as const,
      separator: count === 1 ? "" : " •",
    }
  })
}
