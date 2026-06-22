// Grid keyboard model for /search — a 6-column A–Z letter grid plus an action
// row (shift toggle · space · delete · search). Pure module (no JSX) so the
// edit semantics are unit-testable without loading the component's React/JSX
// module graph under jest-expo. SearchKeyboard is the thin caller.
//
// Replaces the single-row letter strip (keyStrip.ts) with the grid layout the
// app shipped before the redesign — letters laid out as a focusable block
// rather than one long row — restyled in the redesign's SEARCH_THEME look.

/**
 * Action a key performs when pressed. The dispatcher contract between a key
 * cell and the keyboard's onChange / onSubmit props. `shift` is a keyboard
 * case toggle (component state), not a query mutation — see applyKey.
 */
export type KeyAction =
  | { kind: "char"; char: string }
  | { kind: "space" }
  | { kind: "backspace" }
  | { kind: "submit" }
  | { kind: "shift" }

export type KeyCell = {
  /**
   * Stable React key. Letters use POSITION-based ids (`letter-<index>`) so a
   * shift toggle — which changes a cell's label in place — does not remount
   * the cell and lose its focus state. Action keys use fixed ids.
   */
  id: string
  /** Visible glyph. Empty for icon-rendered keys (delete). */
  label: string
  action: KeyAction
  /** Accessibility label overrides the glyph when the glyph is symbolic. */
  accessibilityLabel?: string
  /** Wider than a normal key (the space key spans ~two columns). */
  wide?: boolean
}

/** Design dimensions in 1920-wide canvas units — pass through scale(). */
export const GRID_COLUMNS = 6
export const KEY_SIZE = 72
export const KEY_WIDTH_WIDE = KEY_SIZE * 2 + 10 // space ≈ two columns + one gap
export const KEY_GAP = 10
export const KEY_RADIUS = 12

/**
 * Per-keyboard size tokens (raw 1920-canvas units; consumers pass through
 * scale()). The grid and the single-line (Apple TV) keyboard differ only in
 * these numbers — the focus/animation logic is shared in KeyButton.
 */
export type KeyDims = {
  size: number
  wideWidth: number
  radius: number
  labelFontSize: number
  iconSize: number
}

/** Grid keyboard (Android) — reproduces SearchKeyboard's current pixel values. */
export const GRID_KEY_DIMS: KeyDims = {
  size: KEY_SIZE,
  wideWidth: KEY_WIDTH_WIDE,
  radius: KEY_RADIUS,
  labelFontSize: 26,
  iconSize: 28,
}

/**
 * Single-line keyboard (Apple TV) — compact so ~30 keys fit one row. The size
 * tokens feed LINEAR_KEY_DIMS only (unexported); LINEAR_KEY_GAP is the row
 * style's inter-key gap, consumed by SearchKeyboardLinear.
 */
const LINEAR_KEY_SIZE = 48
const LINEAR_KEY_WIDTH_WIDE = 72
export const LINEAR_KEY_GAP = 8
export const LINEAR_KEY_DIMS: KeyDims = {
  size: LINEAR_KEY_SIZE,
  wideWidth: LINEAR_KEY_WIDTH_WIDE,
  radius: 10,
  labelFontSize: 20,
  iconSize: 24,
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("")

/**
 * Build the letter grid in the active case. Lowercase by default — search is
 * case-insensitive on the backend, and lowercase reads less shouty in the
 * QueryDisplay above. A shift toggle (buildActionRow) flips to uppercase;
 * each letter cell dispatches the character in whatever case is showing, so
 * the typed query preserves the user's case.
 *
 * 26 letters at 6 columns → rows of 6, 6, 6, 6, 2. Letter ids are
 * position-based so toggling case never remounts a cell.
 */
export function buildLetterRows(
  isShifted: boolean,
  columns: number = GRID_COLUMNS,
): KeyCell[][] {
  const rows: KeyCell[][] = []
  LETTERS.forEach((c, index) => {
    const row = Math.floor(index / columns)
    if (rows[row] == null) rows[row] = []
    const display = isShifted ? c.toUpperCase() : c
    rows[row].push({
      id: `letter-${index}`,
      label: display,
      action: { kind: "char", char: display },
    })
  })
  return rows
}

/**
 * The action row: shift toggle · space (wide) · delete · search.
 *
 * The shift key shows the case it switches TO when pressed (iOS/tvOS
 * convention) and is a persistent caps-lock-style toggle, not momentary —
 * easier on a D-pad than a transient shift. The submit (⏎) key is
 * load-bearing: it fires useSemanticSearch.submit(), bypassing the 600ms
 * debounce.
 */
export function buildActionRow(isShifted: boolean): KeyCell[] {
  return [
    {
      id: "shift",
      label: isShifted ? "abc" : "ABC",
      action: { kind: "shift" },
      accessibilityLabel: isShifted
        ? "Switch to lowercase"
        : "Switch to uppercase",
    },
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
    },
    {
      id: "submit",
      label: "⏎",
      action: { kind: "submit" },
      accessibilityLabel: "Search",
    },
  ]
}

/**
 * Flat key list for the single-line (Apple TV) keyboard: the 26 letters in the
 * active case, then the action keys (shift · space · delete · submit). Reuses
 * buildLetterRows + buildActionRow so the linear and grid keyboards stay in
 * lockstep — same cells, same ids, same reducer (applyKey).
 */
export function buildLinearKeys(isShifted: boolean): KeyCell[] {
  return [...buildLetterRows(isShifted).flat(), ...buildActionRow(isShifted)]
}

/**
 * Pure reducer for a key press over the current query string. Returns the
 * NEXT query value for value-mutating actions, or `null` when the action
 * doesn't change the value (submit, shift, or a guarded no-op).
 *
 *   - char:      appends action.char (already cased by buildLetterRows)
 *   - space:     appends " " ONLY when the query is non-empty (no leading
 *                space — a whitespace-only query would flip the results
 *                region to the idle browse grid); no-op (null) on empty
 *   - backspace: drops the last char; no-op (null) on empty
 *   - submit:    no value change (null) — caller fires onSubmit
 *   - shift:     no value change (null) — caller toggles keyboard case state
 */
export function applyKey(value: string, action: KeyAction): string | null {
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
    case "shift":
      return null
    default: {
      // Compile-time exhaustiveness check: a future KeyAction variant errors
      // at tsc until the new `case` is handled above.
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
