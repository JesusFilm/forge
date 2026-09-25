// The reader's own theme (feat-551 KTD12, R34, R35, R36). Four token sets:
// two palettes, each in a light and a dark scheme. The app's Appearance never
// changes; only the reader reads these.
import {
  ACCENT,
  ACCENT_ON_DARK,
  BG_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../color"
import type { ReaderMode, ReaderPalette } from "../settings/snapshot"
import { contrastRatio } from "./contrast"

export const READER_SCHEMES = ["light", "dark"] as const

export type ReaderScheme = (typeof READER_SCHEMES)[number]

export type ReaderTokens = {
  scheme: ReaderScheme
  /** The page. Every other token is judged over it. */
  background: string
  /** The verse, the pill label, and the message buttons. */
  text: string
  /** The footer, the verse number, the missing-verse note, and the credit. */
  secondaryText: string
  progressTrack: string
  progressFill: string
  /** The glass buttons where Liquid Glass is absent (blur tint or flat fill). */
  buttonSurface: string
  /** The glass button glyphs: the app's red, lighter on dark grounds. */
  icon: string
  /** expo-status-bar's style: "light" content on a dark page. */
  statusBarStyle: "light" | "dark"
}

type TokenSet = Readonly<Record<ReaderScheme, Readonly<ReaderTokens>>>

// Classic is the app's warm stone scale. True Dark copies Still's True Dark
// values (JesusFilm/still app/globals.css, read 2026-09-25).
export const READER_PALETTE_TOKENS: Readonly<Record<ReaderPalette, TokenSet>> =
  Object.freeze({
    classic: Object.freeze({
      light: Object.freeze({
        scheme: "light",
        background: "#fafaf9",
        text: "#1c1917",
        secondaryText: "#57534e",
        progressTrack: "#e7e5e4",
        progressFill: "#57534e",
        buttonSurface: "rgba(231, 229, 228, 0.8)",
        icon: ACCENT,
        statusBarStyle: "dark",
      }),
      dark: Object.freeze({
        scheme: "dark",
        background: BG_COLOR,
        text: TEXT_PRIMARY,
        secondaryText: TEXT_SECONDARY,
        progressTrack: "#44403c",
        progressFill: "#d6d3d1",
        buttonSurface: "rgba(41, 37, 36, 0.8)",
        icon: ACCENT_ON_DARK,
        statusBarStyle: "light",
      }),
    }),
    trueDark: Object.freeze({
      light: Object.freeze({
        scheme: "light",
        background: "#ffffff",
        text: "#252525",
        secondaryText: "#626262",
        progressTrack: "#ededed",
        progressFill: "#454545",
        buttonSurface: "rgba(237, 237, 237, 0.9)",
        icon: ACCENT,
        statusBarStyle: "dark",
      }),
      dark: Object.freeze({
        scheme: "dark",
        background: "#000000",
        text: "#e8e8e8",
        secondaryText: "#ababab",
        progressTrack: "#262626",
        progressFill: "#dedede",
        buttonSurface: "rgba(38, 38, 38, 0.9)",
        icon: ACCENT_ON_DARK,
        statusBarStyle: "light",
      }),
    }),
  })

export function readerTokens(
  palette: ReaderPalette,
  scheme: ReaderScheme,
): ReaderTokens {
  return READER_PALETTE_TOKENS[palette][scheme]
}

/** System mode follows the device. With no answer, the app's dark look wins. */
export function resolveReaderScheme(
  mode: ReaderMode,
  systemScheme: string | null | undefined,
): ReaderScheme {
  if (mode !== "system") return mode
  return systemScheme === "light" ? "light" : "dark"
}

export type ContrastCheck = {
  name: string
  ratio: number
  /** 4.5 for text, 3 for glyphs and the progress bar (WCAG 2.1 AA). */
  floor: number
}

/** Every colour pair the reader draws, scored over its real ground. */
export function readerContrastChecks(tokens: ReaderTokens): ContrastCheck[] {
  const { background, buttonSurface, progressTrack } = tokens
  const check = (
    name: string,
    floor: number,
    foreground: string,
    ...grounds: [string, ...string[]]
  ): ContrastCheck => ({
    name,
    floor,
    ratio: contrastRatio(foreground, ...grounds),
  })
  return [
    check("text on background", 4.5, tokens.text, background),
    check(
      "secondary text on background",
      4.5,
      tokens.secondaryText,
      background,
    ),
    check(
      "text on button surface",
      4.5,
      tokens.text,
      buttonSurface,
      background,
    ),
    check("icon on button surface", 3, tokens.icon, buttonSurface, background),
    check("icon on background", 3, tokens.icon, background),
    check(
      "progress fill on track",
      3,
      tokens.progressFill,
      progressTrack,
      background,
    ),
    check("progress fill on background", 3, tokens.progressFill, background),
  ]
}
