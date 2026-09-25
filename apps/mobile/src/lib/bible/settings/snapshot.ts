// The reader's seven settings (feat-551 R33, KTD5), as the device keeps them.
// Pure parse and serialize; the store owns the storage calls. Keys stay
// semantic so a design change never rewrites what the device holds.

export const READER_SETTINGS_STORAGE_KEY = "bible-reader-settings"

/** Increase this when the stored shape changes, so old records read as absent. */
export const READER_SETTINGS_VERSION = 1

export const READER_MODES = ["system", "light", "dark"] as const
export const READER_PALETTES = ["classic", "trueDark"] as const
export const READER_TYPEFACES = ["serif", "sans"] as const
export const READER_LINE_SPACINGS = ["compact", "normal", "relaxed"] as const

/**
 * Text sizes in points, smallest first. U7 tunes these on devices. The device
 * keeps a step index, so a new list keeps each viewer's step; keep the length
 * odd, so the default stays the middle size.
 */
export const READER_TEXT_SIZE_STEPS = [22, 26, 30, 36, 42] as const

export const DEFAULT_TEXT_SIZE_STEP = Math.floor(
  READER_TEXT_SIZE_STEPS.length / 2,
)

export type ReaderMode = (typeof READER_MODES)[number]
export type ReaderPalette = (typeof READER_PALETTES)[number]
export type ReaderTypeface = (typeof READER_TYPEFACES)[number]
export type ReaderLineSpacing = (typeof READER_LINE_SPACINGS)[number]

export type ReaderSettings = {
  mode: ReaderMode
  /** An index into READER_TEXT_SIZE_STEPS. */
  textSizeStep: number
  palette: ReaderPalette
  typeface: ReaderTypeface
  lineSpacing: ReaderLineSpacing
  verseNumbers: boolean
  /** Phones only (R11); iPad-sized screens always show the arrows. */
  showArrows: boolean
}

export const DEFAULT_READER_SETTINGS: Readonly<ReaderSettings> = Object.freeze({
  mode: "system",
  textSizeStep: DEFAULT_TEXT_SIZE_STEP,
  palette: "classic",
  typeface: "serif",
  lineSpacing: "normal",
  verseNumbers: true,
  showArrows: false,
})

function oneOf<T extends string>(
  options: readonly T[],
): (value: unknown) => value is T {
  return (value): value is T =>
    typeof value === "string" && (options as readonly string[]).includes(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function isStep(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value)
}

/** A step outside the list moves to its nearest end. */
export function clampTextSizeStep(step: number): number {
  return Math.min(Math.max(step, 0), READER_TEXT_SIZE_STEPS.length - 1)
}

/** The text size in points for a step. */
export function readerTextSize(step: number): number {
  const index = isStep(step) ? clampTextSizeStep(step) : DEFAULT_TEXT_SIZE_STEP
  return READER_TEXT_SIZE_STEPS[index] ?? READER_TEXT_SIZE_STEPS[0]
}

/** Each check accepts a value that the store may hold for its field. */
export const READER_SETTING_CHECKS: {
  readonly [K in keyof ReaderSettings]: (
    value: unknown,
  ) => value is ReaderSettings[K]
} = {
  mode: oneOf(READER_MODES),
  textSizeStep: (value): value is number =>
    isStep(value) && clampTextSizeStep(value) === value,
  palette: oneOf(READER_PALETTES),
  typeface: oneOf(READER_TYPEFACES),
  lineSpacing: oneOf(READER_LINE_SPACINGS),
  verseNumbers: isBoolean,
  showArrows: isBoolean,
}

/**
 * Null for no record: unwritten, bad JSON, or another version. A field that
 * does not read keeps its default, so one bad field never resets the rest.
 */
export function parseStoredReaderSettings(
  raw: string | null,
): ReaderSettings | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null
  }
  const record = data as Record<string, unknown>
  if (record.version !== READER_SETTINGS_VERSION) return null
  const checks = READER_SETTING_CHECKS
  const pick = <K extends keyof ReaderSettings>(key: K): ReaderSettings[K] => {
    const value = record[key]
    return checks[key](value) ? value : DEFAULT_READER_SETTINGS[key]
  }
  return {
    mode: pick("mode"),
    // A list that got shorter still gives the nearest size, not the default.
    textSizeStep: isStep(record.textSizeStep)
      ? clampTextSizeStep(record.textSizeStep)
      : DEFAULT_TEXT_SIZE_STEP,
    palette: pick("palette"),
    typeface: pick("typeface"),
    lineSpacing: pick("lineSpacing"),
    verseNumbers: pick("verseNumbers"),
    showArrows: pick("showArrows"),
  }
}

export function serializeReaderSettings(settings: ReaderSettings): string {
  return JSON.stringify({ version: READER_SETTINGS_VERSION, ...settings })
}
