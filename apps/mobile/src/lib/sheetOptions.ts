import { BG_COLOR } from "./color"
import { canUseLiquidGlass } from "./liquidGlass"

/** The sheet corner wherever Liquid Glass is unavailable. */
const SHEET_CORNER_RADIUS = 16

/**
 * The options every native form sheet shares (feat-699 KTD7). On iOS 26 the
 * sheet takes the system shape, so the custom corner goes.
 */
export function formSheetBaseOptions() {
  const base = {
    headerShown: false,
    presentation: "formSheet",
    sheetInitialDetentIndex: 0,
    sheetGrabberVisible: true,
  } as const
  return canUseLiquidGlass()
    ? base
    : { ...base, sheetCornerRadius: SHEET_CORNER_RADIUS }
}

/**
 * The fill behind a sheet's content. On iOS 26 it is transparent, because a
 * solid fill hides the system glass sheet (the 2026-10-15 spike).
 */
export function sheetBackground(solid: string = BG_COLOR): string {
  return canUseLiquidGlass() ? "transparent" : solid
}

/** An app form sheet: the shared options and the app's fill. The reader
 *  sheets set their own fill, so they take the base options only. */
export function formSheetOptions() {
  return {
    ...formSheetBaseOptions(),
    contentStyle: { backgroundColor: sheetBackground() },
  }
}
