// The single-row letter strip's key model — A–Z, then the wide space /
// delete / submit keys, mirroring the design's s-keys row. Kept as a pure
// module (not inside SearchKeyboard.tsx) so it is unit-testable without
// loading the component's React/JSX module graph under jest-expo.

/**
 * Action a key performs when pressed. Defines the dispatcher contract
 * between the strip and the keyboard's onChange / onSubmit props.
 */
export type StripKeyAction =
  | { kind: "char"; char: string }
  | { kind: "space" }
  | { kind: "backspace" }
  | { kind: "submit" }

export type StripKey = {
  /** Stable React key — does not collide across letters / action keys. */
  id: string
  /** Visible glyph. Empty for icon-rendered keys (delete). */
  label: string
  action: StripKeyAction
  /** Accessibility label overrides the glyph when the glyph is symbolic. */
  accessibilityLabel?: string
  /** Wide key (space / delete / submit) — design 72px vs 48px. */
  wide: boolean
}

/** Design dimensions in 1920-wide canvas units — pass through scale(). */
export const KEY_WIDTH = 48
export const KEY_WIDTH_WIDE = 72
export const KEY_HEIGHT = 58
export const KEY_GAP = 6

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

/**
 * Build the strip: 26 letters + space + delete + submit (29 keys).
 *
 * Letters dispatch UPPERCASE characters, matching the design's typed-query
 * rendering (and tvOS's native search strip). Search is case-insensitive on
 * the backend, so this is purely presentational.
 *
 * The submit (⏎) key is not in the design but is load-bearing in the
 * current flow — it fires useSemanticSearch.submit(), which bypasses the
 * 600 ms debounce — so it stays as a third wide key.
 */
export function buildSearchStrip(): StripKey[] {
  const letters: StripKey[] = LETTERS.map((ch) => ({
    id: `char-${ch}`,
    label: ch,
    action: { kind: "char", char: ch },
    wide: false,
  }))

  return [
    ...letters,
    {
      id: "space",
      label: "␣",
      action: { kind: "space" },
      accessibilityLabel: "Space",
      wide: true,
    },
    {
      id: "backspace",
      // Rendered as an Ionicons backspace-outline glyph in the component.
      label: "",
      action: { kind: "backspace" },
      accessibilityLabel: "Delete",
      wide: true,
    },
    {
      id: "submit",
      label: "⏎",
      action: { kind: "submit" },
      accessibilityLabel: "Search",
      wide: true,
    },
  ]
}

/**
 * Pure reducer for a key press over the current query string. Returns the
 * NEXT query value for the value-mutating actions, or `null` when the action
 * doesn't change the value (submit, or a guarded no-op).
 *
 * Kept here (not inside SearchKeyboard.tsx) so the keyboard's edit semantics
 * are unit-testable without loading the component's React/JSX module graph
 * under jest-expo. SearchKeyboard is the thin caller: a non-null return is
 * forwarded to onChange; a "submit" action triggers onSubmit instead.
 *
 *   - char:      appends action.char
 *   - space:     appends " " ONLY when the query is non-empty (no leading
 *                space — avoids a whitespace-only query flipping the results
 *                region to an idle-state grid); no-op (null) on empty
 *   - backspace: drops the last char; no-op (null) on empty
 *   - submit:    no value change (null) — caller fires onSubmit
 */
export function applyStripKey(
  value: string,
  action: StripKeyAction,
): string | null {
  switch (action.kind) {
    case "char":
      return value + action.char
    case "space":
      if (value.length === 0) return null
      return value + " "
    case "backspace":
      if (value.length === 0) return null
      return value.slice(0, -1)
    case "submit":
      return null
    default: {
      // Compile-time exhaustiveness check: a future StripKeyAction
      // variant errors at tsc until the new `case` is handled above.
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
