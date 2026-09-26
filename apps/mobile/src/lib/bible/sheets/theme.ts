// The reader sheets use the reader's own theme (feat-553 KTD12), so a light
// reader opens light sheets. theme.test.ts scores every pair below.
import type { ReaderTokens } from "../theme/palettes"

/** The shape `SearchableListSheet` takes as its `colors` prop. */
export type ReaderSheetColors = {
  text: string
  secondaryText: string
  accent: string
  surface: string
}

export function readerSheetColors(tokens: ReaderTokens): ReaderSheetColors {
  return {
    text: tokens.text,
    secondaryText: tokens.secondaryText,
    accent: tokens.icon,
    surface: tokens.buttonSurface,
  }
}

/** The settings sheet's option buttons and switches. */
export type ReaderSheetControlColors = {
  fill: string
  text: string
  /** A chosen option inverts the page, so it keeps the text contrast. */
  selectedFill: string
  selectedText: string
  switchOn: string
  switchOff: string
}

export function readerSheetControlColors(
  tokens: ReaderTokens,
): ReaderSheetControlColors {
  return {
    fill: tokens.buttonSurface,
    text: tokens.text,
    selectedFill: tokens.text,
    selectedText: tokens.background,
    switchOn: tokens.icon,
    switchOff: tokens.progressTrack,
  }
}
