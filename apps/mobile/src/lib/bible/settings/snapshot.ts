// The reader's six settings (feat-553 R33, KTD5), as the device keeps them.
// Pure parse and serialize; the store owns the storage calls. Keys stay
// semantic so a design change never rewrites what the device holds.

export const READER_SETTINGS_STORAGE_KEY = "bible-reader-settings"

/** Increase this when the stored shape changes; `parseStoredReaderSettings`
 *  moves each older version it knows to the current one. */
export const READER_SETTINGS_VERSION = 2

/** True Dark was a separate palette until 2026-09-28 (owner). */
export const READER_MODES = ["system", "light", "dark", "trueDark"] as const
export const READER_TYPEFACES = ["serif", "sans"] as const

/**
 * Text sizes in points, smallest first: eleven steps of 2 pt from 22 to 42,
 * for the settings slider (owner, 2026-09-28). The device keeps a step index.
 */
export const READER_TEXT_SIZE_STEPS = [
  22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42,
] as const

/** 30 pt, the default before the slider. */
export const DEFAULT_TEXT_SIZE_STEP = 4

/**
 * Line heights as a share of the text size: five even steps from compact
 * (1.2) to relaxed (1.6), for the settings slider (owner, 2026-09-28).
 */
export const READER_LINE_SPACING_STEPS = [1.2, 1.3, 1.4, 1.5, 1.6] as const

export const DEFAULT_LINE_SPACING_STEP = 2

export type ReaderMode = (typeof READER_MODES)[number]
export type ReaderTypeface = (typeof READER_TYPEFACES)[number]

export type ReaderSettings = {
  mode: ReaderMode
  /** An index into READER_TEXT_SIZE_STEPS. */
  textSizeStep: number
  typeface: ReaderTypeface
  /** An index into READER_LINE_SPACING_STEPS. */
  lineSpacingStep: number
  verseNumbers: boolean
  /** Phones only (R11); iPad-sized screens always show the arrows. */
  showArrows: boolean
}

export const DEFAULT_READER_SETTINGS: Readonly<ReaderSettings> = Object.freeze({
  // The owner chose Dark over System as the first mode (2026-09-25).
  mode: "dark",
  textSizeStep: DEFAULT_TEXT_SIZE_STEP,
  typeface: "serif",
  lineSpacingStep: DEFAULT_LINE_SPACING_STEP,
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

/** A step outside the list moves to its nearest end. */
export function clampLineSpacingStep(step: number): number {
  return Math.min(Math.max(step, 0), READER_LINE_SPACING_STEPS.length - 1)
}

/** The text size in points for a step. */
export function readerTextSize(step: number): number {
  const index = isStep(step) ? clampTextSizeStep(step) : DEFAULT_TEXT_SIZE_STEP
  return READER_TEXT_SIZE_STEPS[index] ?? READER_TEXT_SIZE_STEPS[0]
}

/** The line height, as a share of the text size, for a step. */
export function readerLineSpacing(step: number): number {
  const index = isStep(step)
    ? clampLineSpacingStep(step)
    : DEFAULT_LINE_SPACING_STEP
  return READER_LINE_SPACING_STEPS[index] ?? READER_LINE_SPACING_STEPS[0]
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
  typeface: oneOf(READER_TYPEFACES),
  lineSpacingStep: (value): value is number =>
    isStep(value) && clampLineSpacingStep(value) === value,
  verseNumbers: isBoolean,
  showArrows: isBoolean,
}

// Version 1 kept five sizes (22, 26, 30, 36, 42 pt), three named spacings, and
// a palette. Each maps to its nearest new value, and Dark with the True Dark
// palette is the True Dark mode, so an update never resets a viewer's settings.
const V1_TEXT_SIZE_STEPS = [0, 2, 4, 7, 10] as const
const V1_LINE_SPACING_STEPS: Readonly<Record<string, number>> = {
  compact: 0,
  normal: DEFAULT_LINE_SPACING_STEP,
  relaxed: READER_LINE_SPACING_STEPS.length - 1,
}

function fromVersion1(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const { textSizeStep, lineSpacing, palette, ...rest } = record
  const last = V1_TEXT_SIZE_STEPS.length - 1
  return {
    ...rest,
    mode:
      rest.mode === "dark" && palette === "trueDark" ? "trueDark" : rest.mode,
    textSizeStep: isStep(textSizeStep)
      ? V1_TEXT_SIZE_STEPS[Math.min(Math.max(textSizeStep, 0), last)]
      : undefined,
    lineSpacingStep:
      typeof lineSpacing === "string"
        ? V1_LINE_SPACING_STEPS[lineSpacing]
        : undefined,
  }
}

/**
 * Null for no record: unwritten, bad JSON, or an unknown version. A field
 * that does not read keeps its default, so one bad field never resets the rest.
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
  const stored = data as Record<string, unknown>
  let record: Record<string, unknown>
  if (stored.version === READER_SETTINGS_VERSION) record = stored
  else if (stored.version === 1) record = fromVersion1(stored)
  else return null
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
    typeface: pick("typeface"),
    lineSpacingStep: isStep(record.lineSpacingStep)
      ? clampLineSpacingStep(record.lineSpacingStep)
      : DEFAULT_LINE_SPACING_STEP,
    verseNumbers: pick("verseNumbers"),
    showArrows: pick("showArrows"),
  }
}

export function serializeReaderSettings(settings: ReaderSettings): string {
  return JSON.stringify({ version: READER_SETTINGS_VERSION, ...settings })
}
