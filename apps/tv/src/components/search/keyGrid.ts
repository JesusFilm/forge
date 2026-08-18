// Grid keyboard model for /search: 6-column A–Z grid plus action row (shift ·
// space · delete · search). Pure module (no JSX) so edit semantics are testable
// under jest-expo. Replaces keyStrip.ts's single row with a SEARCH_THEME block.

/**
 * Action a key performs when pressed — the contract between a key cell and the
 * keyboard's onChange/onSubmit. `shift` toggles keyboard case (component state),
 * not a query mutation; see applyKey.
 */
export type KeyAction =
  | { kind: "char"; char: string }
  | { kind: "space" }
  | { kind: "backspace" }
  | { kind: "submit" }
  | { kind: "shift" }
  | { kind: "mic" }

export type KeyCell = {
  /**
   * Stable React key. Letters use POSITION-based ids (`letter-<index>`) so a
   * shift toggle (changes label in place) doesn't remount the cell and lose
   * focus state. Action keys use fixed ids.
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
 * Build the letter grid in the active case (lowercase default; shift flips to
 * uppercase and each cell dispatches the shown case, preserving it). 26 letters
 * at 6 columns → rows of 6,6,6,6,2; ids are position-based so case never remounts.
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
 * The action row: shift toggle · space (wide) · delete · search, plus a voice
 * key when the device has a speech recognizer (`includeMicKey` — Android TV
 * only; Apple TV's dictation lives in the native search surface instead). Shift
 * shows the case it switches TO (iOS/tvOS convention) and is a persistent
 * caps-lock toggle, easier on a D-pad. Submit (⏎) fires
 * useSemanticSearch.submit(), skipping debounce.
 */
export function buildActionRow(
  isShifted: boolean,
  includeMicKey: boolean = false,
): KeyCell[] {
  const micKey: KeyCell[] = includeMicKey
    ? [
        {
          id: "mic",
          // Rendered as an Ionicons mic-outline glyph in the component.
          label: "",
          action: { kind: "mic" },
          accessibilityLabel: "Voice search",
        },
      ]
    : []
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
    ...micKey,
  ]
}

/**
 * Flat key list for the single-line (Apple TV) keyboard: 26 letters in the
 * active case, then action keys (shift · space · delete · submit). Reuses
 * buildLetterRows + buildActionRow so linear/grid stay in lockstep (applyKey).
 */
export function buildLinearKeys(isShifted: boolean): KeyCell[] {
  return [...buildLetterRows(isShifted).flat(), ...buildActionRow(isShifted)]
}

/**
 * Pure reducer for a key press over the query string. Returns the NEXT value
 * (char appends; space appends only when non-empty so a whitespace-only query
 * doesn't flip to browse; backspace drops last), or `null` for no-ops.
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
    case "mic":
      // Voice capture is the keyboard component's side effect, not a text edit.
      return null
    default: {
      // Compile-time exhaustiveness check: a future KeyAction variant errors
      // at tsc until the new `case` is handled above.
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}
