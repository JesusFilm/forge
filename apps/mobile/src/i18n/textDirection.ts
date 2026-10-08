// KTD13: a text takes its direction from its own language, never from the
// layout, so the app keeps a left-to-right layout for every UI language (KD3).
import { useMemo } from "react"
import { Platform } from "react-native"

import { useUiTag } from "../hooks/useUiTag"
import { isRtlTag } from "./resolveLocale"

/** Android reads `direction` and iOS reads `writingDirection`. */
export type TextDirectionStyle = {
  readonly direction: "ltr" | "rtl"
  readonly writingDirection: "ltr" | "rtl"
}

export const RTL_STYLE: TextDirectionStyle = Object.freeze({
  direction: "rtl",
  writingDirection: "rtl",
})

export const LTR_STYLE: TextDirectionStyle = Object.freeze({
  direction: "ltr",
  writingDirection: "ltr",
})

export type TextDirectionOptions = {
  /** Centered text keeps its alignment in every language. */
  readonly centered?: boolean
}

/** The direction props for one text element. Both are undefined for
 *  left-to-right text in a left-to-right UI in the same language. */
export type TextDirectionProps = {
  readonly style: TextDirectionStyle | undefined
  readonly accessibilityLanguage: string | undefined
}

function isKnown(lang: string | null | undefined): lang is string {
  return lang != null && lang.trim() !== ""
}

function primaryLanguage(tag: string): string {
  return tag.trim().replace(/_/g, "-").split("-")[0]?.toLowerCase() ?? ""
}

/** The style for one left-aligned `<Text>`, never a container. `lang` is the
 *  catalog tag for UI text and the `lang` field for Admin text. Other text
 *  gets `ltr` only in a right-to-left UI, so English fallback aligns left. */
export function textDirectionStyle(
  lang: string | null | undefined,
  uiTag: string,
  options: TextDirectionOptions = {},
): TextDirectionStyle | undefined {
  if (options.centered === true || !isKnown(lang)) return undefined
  if (isRtlTag(lang)) return RTL_STYLE
  return isRtlTag(uiTag) ? LTR_STYLE : undefined
}

/** The screen-reader language for text in a language other than the UI's,
 *  such as English fallback text (R10). React Native reads
 *  `accessibilityLanguage` on iOS only, so other platforms get undefined. */
export function textAccessibilityLanguage(
  lang: string | null | undefined,
  uiTag: string,
  os: string = Platform.OS,
): string | undefined {
  if (os !== "ios" || !isKnown(lang)) return undefined
  return primaryLanguage(lang) === primaryLanguage(uiTag) ? undefined : lang
}

/** The style and the screen-reader language for one text element. */
export function textDirectionProps(
  lang: string | null | undefined,
  uiTag: string,
  options: TextDirectionOptions = {},
): TextDirectionProps {
  return {
    style: textDirectionStyle(lang, uiTag, options),
    accessibilityLanguage: textAccessibilityLanguage(lang, uiTag),
  }
}

export type TextDirection = {
  /** The UI catalog tag, e.g. `ar`. */
  readonly uiTag: string
  /** The style for UI text from the catalog; undefined in a left-to-right UI. */
  readonly ui: TextDirectionStyle | undefined
  /** The props for text in the language `lang`, such as Admin text. */
  readonly text: (
    lang: string | null | undefined,
    options?: TextDirectionOptions,
  ) => TextDirectionProps
}

/** The direction helpers for the current UI language. A language change
 *  re-renders the caller. */
export function useTextDirection(): TextDirection {
  const uiTag = useUiTag()
  return useMemo(
    () => ({
      uiTag,
      ui: textDirectionStyle(uiTag, uiTag),
      text: (lang, options) => textDirectionProps(lang, uiTag, options),
    }),
    [uiTag],
  )
}
