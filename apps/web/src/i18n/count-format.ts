import {
  _createCache,
  _createIntlFormatters,
  createTranslator,
  type AbstractIntlMessages,
} from "next-intl"

import { COUNT_NUMBER_FORMAT_CLASSES } from "./generated-count-number-formats"

// Watch counts ("2,273 languages") must read the same in server HTML and after
// hydration. The runtime's own `Intl.NumberFormat` cannot promise that: Node
// ships full ICU, while Chromium has no number data for Tswana, Ewe, Kyrgyz and
// ~150 other Watch UI locales and silently formats them in the VISITOR's
// browser locale instead (2'273 on the server, 2,273 or 2.273 in the browser).
// Even locales both sides support can differ by CLDR version. Counts are
// therefore formatted from a committed per-locale table on both sides. See
// scripts/generate-count-number-formats.mjs.
//
// next-intl exposes no public way to swap only the number formatter, so this
// uses its underscore-prefixed `_createIntlFormatters` / `_formatters` seam
// (verified on next-intl 4.13.0). count-format.test.ts is the upgrade tripwire:
// if the seam stops being honoured, its Tswana parity test fails.

export type CountNumberFormatSpec = {
  /** The ten digits 0-9 in the locale's default numbering system. */
  digits: string
  /** Grouping separator; empty when the locale does not group. */
  group: string
  /** Digits that must precede the first separator (CLDR). */
  minimumGroupingDigits: number
  /** Size of the rightmost group. */
  primaryGroupSize: number
  /** Size of every group left of the rightmost one. */
  secondaryGroupSize: number
}

const SPECS_BY_LOCALE: ReadonlyMap<string, CountNumberFormatSpec> = new Map(
  COUNT_NUMBER_FORMAT_CLASSES.flatMap(({ locales, spec }) =>
    locales.map((locale) => [locale, spec] as const),
  ),
)

export const FALLBACK_COUNT_NUMBER_FORMAT_LOCALE = "en"

export class CountFormatTableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CountFormatTableError"
  }
}

export function countNumberFormatSpecFor(
  locale: string,
): CountNumberFormatSpec {
  const spec =
    SPECS_BY_LOCALE.get(locale) ??
    SPECS_BY_LOCALE.get(FALLBACK_COUNT_NUMBER_FORMAT_LOCALE)
  if (!spec) {
    throw new CountFormatTableError(
      `generated-count-number-formats.ts has no "${FALLBACK_COUNT_NUMBER_FORMAT_LOCALE}" entry`,
    )
  }
  return spec
}

export function hasCountNumberFormatSpec(locale: string): boolean {
  return SPECS_BY_LOCALE.has(locale)
}

function formatCountWithSpec(
  count: number,
  spec: CountNumberFormatSpec,
): string {
  const digits = [...spec.digits]
  const native = [...String(count)].map((digit) => digits[Number(digit)])
  if (
    !spec.group ||
    native.length < spec.primaryGroupSize + spec.minimumGroupingDigits
  ) {
    return native.join("")
  }
  const groups = [native.splice(-spec.primaryGroupSize).join("")]
  while (native.length > 0) {
    groups.unshift(native.splice(-spec.secondaryGroupSize).join(""))
  }
  return groups.join(spec.group)
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

/**
 * Formats a non-negative integer count identically on the server and in every
 * browser. Anything that is not a count falls back to the runtime formatter.
 */
export function formatCount(count: number, locale: string): string {
  return isCount(count)
    ? formatCountWithSpec(count, countNumberFormatSpecFor(locale))
    : new Intl.NumberFormat(locale).format(count)
}

type IntlFormatters = ReturnType<typeof _createIntlFormatters>

function countSafeFormatters(locale: string): IntlFormatters {
  const formatters = _createIntlFormatters(_createCache())
  return {
    ...formatters,
    // ICU `#` (and a bare `{n, number}`) asks for a formatter with no
    // options; only those integer counts go through the table. Styled number
    // formats keep the runtime formatter. The message formatter only calls
    // `format` on what this returns.
    getNumberFormat: (locales, options) => {
      const native = formatters.getNumberFormat(locales, options)
      if (options !== undefined) return native
      const countFormat: Pick<Intl.NumberFormat, "format"> = {
        format: (value: number | bigint) =>
          isCount(value) ? formatCount(value, locale) : native.format(value),
      }
      return countFormat as Intl.NumberFormat
    },
  }
}

export type CountTranslator = (key: string, values: { count: number }) => string

/**
 * A translator for count messages (`{count, plural, ... # ...}`) whose `#`
 * renders through {@link formatCount}. Plural selection still uses the UI
 * locale's own rules.
 */
export function createCountTranslator({
  locale,
  messages,
  namespace,
}: {
  locale: string
  messages: AbstractIntlMessages
  namespace: string
}): CountTranslator {
  const translate = createTranslator({
    _formatters: countSafeFormatters(locale),
    locale,
    messages,
    namespace,
  }) as unknown as CountTranslator
  return (key, values) => translate(key, values)
}
