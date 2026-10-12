// KTD13: a text takes its writing direction from its own language. feat-694
// KTD6: with mirroring on, its edge follows R15-R17 in both layout directions.
import { useMemo } from "react"
import { Platform } from "react-native"

import { useUiTag } from "../hooks/useUiTag"
import { isLayoutRtl } from "./layoutRtl"
import { MIRRORED_LAYOUT_ENABLED } from "./mirroredLayout"
import { isRtlTag } from "./resolveLocale"

/** Android reads `direction` and iOS reads `writingDirection`. */
export type TextDirectionStyle = {
  readonly direction: "ltr" | "rtl"
  readonly writingDirection: "ltr" | "rtl"
  /** Relative to the text's own direction: "left" is its start, "right" its end. */
  readonly textAlign?: "left" | "right"
}

const RTL_STYLE: TextDirectionStyle = Object.freeze({
  direction: "rtl",
  writingDirection: "rtl",
})

const LTR_STYLE: TextDirectionStyle = Object.freeze({
  direction: "ltr",
  writingDirection: "ltr",
})

// Device check (feat-694 U4): with `direction` set to the text's own language,
// both platforms read `textAlign` "left" as that language's start edge.
const EDGE_STYLES = {
  ltr: {
    start: Object.freeze({ ...LTR_STYLE, textAlign: "left" as const }),
    end: Object.freeze({ ...LTR_STYLE, textAlign: "right" as const }),
  },
  rtl: {
    start: Object.freeze({ ...RTL_STYLE, textAlign: "left" as const }),
    end: Object.freeze({ ...RTL_STYLE, textAlign: "right" as const }),
  },
}

/** Paragraphs keep the start edge of their own language (R17). Text inputs
 *  count as short text. */
export type TextKind = "short" | "paragraph"

export type TextDirectionOptions = {
  /** Centered text keeps its alignment in every language. */
  readonly centered?: boolean
  /** Short text by default. */
  readonly kind?: TextKind
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

/** The style for one start-aligned `<Text>`, never a container. `lang` is the
 *  catalog tag for UI text and the `lang` field for Admin text. With mirroring
 *  off, other text gets `ltr` only in a right-to-left UI (today's rule, R10). */
export function textDirectionStyle(
  lang: string | null | undefined,
  uiTag: string,
  options: TextDirectionOptions = {},
): TextDirectionStyle | undefined {
  if (options.centered === true || !isKnown(lang)) return undefined
  const textRtl = isRtlTag(lang)
  if (!MIRRORED_LAYOUT_ENABLED) {
    if (textRtl) return RTL_STYLE
    return isRtlTag(uiTag) ? LTR_STYLE : undefined
  }
  return edgeStyle(textRtl, options.kind)
}

/** For text whose direction is known but not its language, such as a Bible
 *  translation. With mirroring off, it is the explicit direction, as today. */
export function explicitDirectionStyle(
  direction: "ltr" | "rtl",
  options: { readonly kind?: TextKind } = {},
): TextDirectionStyle {
  const textRtl = direction === "rtl"
  if (!MIRRORED_LAYOUT_ENABLED) return textRtl ? RTL_STYLE : LTR_STYLE
  return edgeStyle(textRtl, options.kind)
}

// R16: short text in the other direction goes to the layout's start edge,
// which is the end edge of its own language.
function edgeStyle(textRtl: boolean, kind: TextKind | undefined) {
  const other = textRtl !== isLayoutRtl()
  const edge = other && kind !== "paragraph" ? "end" : "start"
  return EDGE_STYLES[textRtl ? "rtl" : "ltr"][edge]
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
  /** The style for short UI text from the catalog. */
  readonly ui: TextDirectionStyle | undefined
  /** The style for a UI paragraph from the catalog (R17). */
  readonly uiParagraph: TextDirectionStyle | undefined
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
      uiParagraph: textDirectionStyle(uiTag, uiTag, { kind: "paragraph" }),
      text: (lang, options) => textDirectionProps(lang, uiTag, options),
    }),
    [uiTag],
  )
}
