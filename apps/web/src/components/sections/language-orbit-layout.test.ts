import { describe, expect, it } from "vitest"

import {
  EARTH_ATMOSPHERE_RADIUS,
  LANGUAGE_ORBIT_X_RADIUS,
  LANGUAGE_ORBIT_Z_RADIUS,
  buildLanguageOrbitLayout,
  resolveOrbitTypography,
} from "./language-orbit-layout"
import { ARABIC_ORBIT_FONT, LATIN_ORBIT_FONT } from "./language-orbit-assets"
import type { LanguageGlobeEntry } from "./language-globe-model"

function language(
  nativeLabel: string,
  englishLabel = nativeLabel,
): LanguageGlobeEntry {
  return {
    id: englishLabel,
    nativeLabel,
    englishLabel,
    href: `/${englishLabel.toLowerCase()}.html/videos`,
    latitude: null,
    longitude: null,
  }
}

describe("language orbit layout", () => {
  it("returns no placements for an empty catalog", () => {
    expect(buildLanguageOrbitLayout([])).toEqual([])
  })

  it("places one language once without a duplicate separator mesh", () => {
    const placements = buildLanguageOrbitLayout([language("English")])
    expect(placements).toHaveLength(1)
    expect(placements[0]).toMatchObject({
      label: "English",
      separator: "",
      direction: "ltr",
      position: [LANGUAGE_ORBIT_X_RADIUS, 0, 0],
    })
  })

  it("distributes labels deterministically around one shell-clearing ellipse", () => {
    const placements = buildLanguageOrbitLayout([
      language("English"),
      language("Français"),
      language("Español"),
      language("Deutsch"),
    ])

    expect(placements.map(({ position }) => position)).toEqual(
      buildLanguageOrbitLayout([
        language("English"),
        language("Français"),
        language("Español"),
        language("Deutsch"),
      ]).map(({ position }) => position),
    )
    const angles = placements.map(({ position: [x, , z] }) => {
      const angle = Math.atan2(
        z / LANGUAGE_ORBIT_Z_RADIUS,
        x / LANGUAGE_ORBIT_X_RADIUS,
      )
      return angle < 0 ? angle + Math.PI * 2 : angle
    })
    expect(
      angles.every((angle, index) => index === 0 || angle > angles[index - 1]),
    ).toBe(true)
    expect(
      placements.every(({ position }) => {
        const distance = Math.hypot(...position)
        return distance > EARTH_ATMOSPHERE_RADIUS
      }),
    ).toBe(true)
    expect(placements.map(({ color }) => color)).toEqual([
      "#3b82f6",
      "#22d3ee",
      "#2dd4bf",
      "#fbbf24",
    ])
  })

  it("uses the local Arabic font and RTL direction for joined Arabic", () => {
    expect(resolveOrbitTypography(language("العربية", "Arabic"))).toEqual({
      label: "العربية",
      direction: "rtl",
      font: ARABIC_ORBIT_FONT,
    })
  })

  it("uses the native label for supported accented Latin and Turkish", () => {
    expect(resolveOrbitTypography(language("TÜRKÇE", "Turkish"))).toMatchObject(
      {
        label: "TÜRKÇE",
        direction: "ltr",
      },
    )
    expect(
      resolveOrbitTypography(language("PORTUGUÊS", "Portuguese")),
    ).toMatchObject({
      label: "PORTUGUÊS",
    })
  })

  it("uses the existing English label for scripts outside local font coverage", () => {
    expect(resolveOrbitTypography(language("中文", "Chinese"))).toEqual({
      label: "Chinese",
      direction: "ltr",
      font: LATIN_ORBIT_FONT,
    })
    expect(
      resolveOrbitTypography(language("普通話", "Mandarin, China")),
    ).toMatchObject({ label: "Mandarin" })
  })
})
