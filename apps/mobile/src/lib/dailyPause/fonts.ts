// The Pass 2 faces load at run time (KTD16), not through the expo-font config
// plugin, so a font change ships as an update. Each family string is the
// file's own PostScript name; assets/fonts/README.md records the check.
import * as Font from "expo-font"
import { useCallback, useEffect, useState } from "react"
import { Platform, type TextStyle } from "react-native"

/** One static face of the Figma frame "Pass 2 · Dark, pill stepper". */
export type PauseFace =
  | "display"
  | "bodyLight"
  | "bodyLightItalic"
  | "bodyItalic"
  | "sansRegular"
  | "sansMedium"
  | "sansSemiBold"
  | "sansBold"

export type PauseFontStyle = Pick<
  TextStyle,
  "fontFamily" | "fontStyle" | "fontWeight"
>

type FaceSpec = {
  postScriptName: string
  /** The asset module. The file name equals the PostScript name. */
  source: number
  role: "serif" | "sans"
  fallbackStyle: "normal" | "italic"
  fallbackWeight: "300" | "400" | "500" | "600" | "700"
}

// Metro finds an asset only through a literal require.
/* eslint-disable @typescript-eslint/no-require-imports */
const FACES: Readonly<Record<PauseFace, FaceSpec>> = {
  display: {
    postScriptName: "InstrumentSerif-Regular",
    source: require("../../../assets/fonts/InstrumentSerif-Regular.ttf"),
    role: "serif",
    fallbackStyle: "normal",
    fallbackWeight: "400",
  },
  bodyLight: {
    postScriptName: "SourceSerif4-Light",
    source: require("../../../assets/fonts/SourceSerif4-Light.ttf"),
    role: "serif",
    fallbackStyle: "normal",
    fallbackWeight: "300",
  },
  bodyLightItalic: {
    postScriptName: "SourceSerif4-LightIt",
    source: require("../../../assets/fonts/SourceSerif4-LightIt.ttf"),
    role: "serif",
    fallbackStyle: "italic",
    fallbackWeight: "300",
  },
  bodyItalic: {
    postScriptName: "SourceSerif4-It",
    source: require("../../../assets/fonts/SourceSerif4-It.ttf"),
    role: "serif",
    fallbackStyle: "italic",
    fallbackWeight: "400",
  },
  sansRegular: {
    postScriptName: "Inter-Regular",
    source: require("../../../assets/fonts/Inter-Regular.ttf"),
    role: "sans",
    fallbackStyle: "normal",
    fallbackWeight: "400",
  },
  sansMedium: {
    postScriptName: "Inter-Medium",
    source: require("../../../assets/fonts/Inter-Medium.ttf"),
    role: "sans",
    fallbackStyle: "normal",
    fallbackWeight: "500",
  },
  sansSemiBold: {
    postScriptName: "Inter-SemiBold",
    source: require("../../../assets/fonts/Inter-SemiBold.ttf"),
    role: "sans",
    fallbackStyle: "normal",
    fallbackWeight: "600",
  },
  sansBold: {
    postScriptName: "Inter-Bold",
    source: require("../../../assets/fonts/Inter-Bold.ttf"),
    role: "sans",
    fallbackStyle: "normal",
    fallbackWeight: "700",
  },
}
/* eslint-enable @typescript-eslint/no-require-imports */

const FONT_MAP: Readonly<Record<string, number>> = Object.fromEntries(
  Object.values(FACES).map((spec) => [spec.postScriptName, spec.source]),
)

// iOS has no family named "serif", so it falls back to Georgia instead.
const SYSTEM_SERIF = Platform.select({ ios: "Georgia", default: "serif" })
const SYSTEM_SANS = Platform.select({ ios: "System", default: "sans-serif" })

type LoadState = "loading" | "loaded" | "failed"

function allFacesLoaded(): boolean {
  return Object.keys(FONT_MAP).every((name) => Font.isLoaded(name))
}

function styleFor(face: PauseFace, state: LoadState): PauseFontStyle {
  const spec = FACES[face]
  if (state === "loaded") return { fontFamily: spec.postScriptName }
  return {
    fontFamily: spec.role === "serif" ? SYSTEM_SERIF : SYSTEM_SANS,
    fontStyle: spec.fallbackStyle,
    fontWeight: spec.fallbackWeight,
  }
}

/** Reads a face's style. Every Pause screen takes one as its `font`. */
export type PauseFont = (face: PauseFace) => PauseFontStyle

/** One text type of the flow: its face and its size. The color stays with
 *  each screen. */
export type PauseTextType = { face: PauseFace } & Pick<
  TextStyle,
  "fontSize" | "lineHeight" | "letterSpacing" | "textTransform"
>

/** The full style of a text type, in the face that `font` gives. */
export function pauseText(
  font: PauseFont,
  { face, ...size }: PauseTextType,
): TextStyle {
  return { ...font(face), ...size }
}

/**
 * Loads the Pass 2 faces. `ready` turns true when the load ends, also on a
 * failure: then `font()` gives a system face, so text never renders blank.
 */
export function usePauseFonts(): {
  ready: boolean
  font: PauseFont
} {
  // A screen that mounts after the load starts ready, so it never swaps faces.
  const [state, setState] = useState<LoadState>(() =>
    allFacesLoaded() ? "loaded" : "loading",
  )

  useEffect(() => {
    // Effect-local, so a StrictMode setup → cleanup → setup re-arms it.
    let active = true
    Font.loadAsync(FONT_MAP).then(
      () => {
        if (active) setState("loaded")
      },
      () => {
        if (active) setState("failed")
      },
    )
    return () => {
      active = false
    }
  }, [])

  const font = useCallback((face: PauseFace) => styleFor(face, state), [state])
  return { ready: state !== "loading", font }
}
