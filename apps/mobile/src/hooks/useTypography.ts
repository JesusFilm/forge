import { useMemo } from "react"
import { type TextStyle, useWindowDimensions } from "react-native"

type TypographyToken = Required<Pick<TextStyle, "fontSize" | "lineHeight">>

type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

const BASE_WIDTH = 375
const MIN_FACTOR = 0.85
const MAX_FACTOR = 1.15

const BASE_SCALE = {
  caption: { fontSize: 12, lineHeight: 16 },
  bodySmall: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 16, lineHeight: 24 },
  titleSmall: { fontSize: 18, lineHeight: 24 },
  titleLarge: { fontSize: 22, lineHeight: 28 },
  heading: { fontSize: 24, lineHeight: 32 },
  display: { fontSize: 56, lineHeight: 68 },
} as const satisfies Record<string, TypographyToken>

const HEADING_SCALE = {
  h1: { fontSize: 32, lineHeight: 40 },
  h2: { fontSize: 28, lineHeight: 36 },
  h3: { fontSize: 24, lineHeight: 32 },
  h4: { fontSize: 20, lineHeight: 28 },
  h5: { fontSize: 18, lineHeight: 24 },
  h6: { fontSize: 16, lineHeight: 22 },
} as const satisfies Record<HeadingLevel, TypographyToken>

export type TypographyScale = {
  caption: TypographyToken
  bodySmall: TypographyToken
  body: TypographyToken
  titleSmall: TypographyToken
  titleLarge: TypographyToken
  heading: TypographyToken
  display: TypographyToken
  headingScale: Record<HeadingLevel, TypographyToken>
}

export function computeTypographyScale(screenWidth: number): TypographyScale {
  const raw = screenWidth / BASE_WIDTH
  const factor = Math.min(Math.max(raw, MIN_FACTOR), MAX_FACTOR)

  // Math.round() all values — critical on Android to avoid sub-pixel blur.
  const scale = (token: TypographyToken): TypographyToken => ({
    fontSize: Math.round(token.fontSize * factor),
    lineHeight: Math.round(token.lineHeight * factor),
  })

  return {
    caption: scale(BASE_SCALE.caption),
    bodySmall: scale(BASE_SCALE.bodySmall),
    body: scale(BASE_SCALE.body),
    titleSmall: scale(BASE_SCALE.titleSmall),
    titleLarge: scale(BASE_SCALE.titleLarge),
    heading: scale(BASE_SCALE.heading),
    display: scale(BASE_SCALE.display),
    headingScale: {
      h1: scale(HEADING_SCALE.h1),
      h2: scale(HEADING_SCALE.h2),
      h3: scale(HEADING_SCALE.h3),
      h4: scale(HEADING_SCALE.h4),
      h5: scale(HEADING_SCALE.h5),
      h6: scale(HEADING_SCALE.h6),
    },
  }
}

/**
 * Responsive typography tokens scaled by screen width vs a 375px baseline,
 * clamped 0.85x-1.15x and Math.round()'d (Android sub-pixel sizes blur).
 * Text's allowFontScaling still applies on top, preserving a11y scaling.
 */
export function useTypography(): TypographyScale {
  const { width } = useWindowDimensions()
  return useMemo(() => computeTypographyScale(width), [width])
}
