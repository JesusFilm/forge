import {
  isArgumentElement,
  isDateElement,
  isLiteralElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  parse,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser"
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js"
import {
  createTranslator,
  type AbstractIntlMessages,
  type TranslationValues,
} from "use-intl/core"

import { isRtlTag } from "./resolveLocale"

export type { TranslationValues }

export type CatalogMessages = Readonly<Record<string, unknown>>

export type UiTranslator = {
  /** The catalog the text comes from, e.g. `zh-Hans`. */
  readonly catalogTag: string
  /** The CLDR plural data tag the catalog formats under, e.g. `zh`. */
  readonly pluralTag: string
  /** Formats a full dotted key. Never throws; see createUiTranslator. */
  translate(key: string, values?: TranslationValues): string
  /** True when the active catalog itself has a message at this key. */
  has(key: string): boolean
}

export type UiTranslatorOptions = {
  catalogTag: string
  pluralTag: string
  messages: CatalogMessages
  /** Requested on the first failure, so English loads lazily; null for English. */
  fallback: (() => UiTranslator) | null
}

type LooseTranslate = ((key: string, values?: TranslationValues) => string) & {
  has(key: string): boolean
}

// use-intl hands this back instead of text when a message is missing or fails
// to format, so the wrapper can tell a failure from a real string.
const FAILED = "\u0000ui-message-failed\u0000"

const FIRST_STRONG_ISOLATE = "\u2068"
const POP_DIRECTIONAL_ISOLATE = "\u2069"

// Strong right-to-left letters: Hebrew through Arabic Extended, the Hebrew and
// Arabic presentation forms, and the supplementary right-to-left blocks.
const RTL_CHARACTER =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]|[\uD802\uD803\uD83A\uD83B][\uDC00-\uDFFF]/

function messageAt(messages: CatalogMessages, key: string): string | undefined {
  let node: unknown = messages
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === "string" ? node : undefined
}

const plainArgumentCache = new Map<string, ReadonlySet<string>>()

// Arguments used only as a plain `{arg}`. An argument that also drives a
// plural, select, number, date, or time never qualifies.
function plainArguments(message: string): ReadonlySet<string> {
  const cached = plainArgumentCache.get(message)
  if (cached) return cached
  const plain = new Set<string>()
  const controlling = new Set<string>()
  const walk = (elements: MessageFormatElement[]): void => {
    for (const element of elements) {
      if (isArgumentElement(element)) {
        plain.add(element.value)
      } else if (isPluralElement(element) || isSelectElement(element)) {
        controlling.add(element.value)
        for (const option of Object.values(element.options)) walk(option.value)
      } else if (
        isNumberElement(element) ||
        isDateElement(element) ||
        isTimeElement(element)
      ) {
        controlling.add(element.value)
      } else if (isTagElement(element)) {
        walk(element.children)
      }
    }
  }
  try {
    walk(parse(message))
  } catch {
    // A message that does not parse also fails to format, and falls back.
  }
  for (const name of controlling) plain.delete(name)
  plainArgumentCache.set(message, plain)
  return plain
}

// KTD13: wraps a string value in FSI and PDI only in a plain `{arg}`, and only
// when the text is right-to-left or the value has a right-to-left letter. The
// parse runs only then, so left-to-right English stays byte-identical.
function isolateValues(
  message: string,
  values: TranslationValues | undefined,
  rtlText: boolean,
): TranslationValues | undefined {
  if (!values) return values
  let isolated: TranslationValues | undefined
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string") continue
    if (!rtlText && !RTL_CHARACTER.test(value)) continue
    if (!plainArguments(message).has(name)) continue
    isolated ??= { ...values }
    isolated[name] = `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`
  }
  return isolated ?? values
}

const reportedFailures = new Set<string>()

/** Logs once per catalog and key. Telemetry must never break a render. */
function reportMessageError(key: string, catalogTag: string, code: string) {
  const id = `${catalogTag}|${key}`
  if (reportedFailures.has(id)) return
  reportedFailures.add(id)
  try {
    // Lazy: most UI modules use the translator, and the Datadog helper pulls
    // in env.ts. Only the failure path needs it.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { datadogLog } =
      require("../lib/datadog") as typeof import("../lib/datadog")
    /* eslint-enable @typescript-eslint/no-require-imports */
    datadogLog.warn("ui_locale.message_error", {
      "ui_locale.key": key,
      "ui_locale.catalog": catalogTag,
      "ui_locale.error_code": code,
    })
  } catch {
    // The English text still renders.
  }
}

export function resetMessageErrorReportsForTests(): void {
  reportedFailures.clear()
}

// KTD1: on a missing key or a format error, the same key and values format
// through the English translator and `ui_locale.message_error` logs once. If
// English fails too, the key path renders, so a render never throws.
export function createUiTranslator(options: UiTranslatorOptions): UiTranslator {
  const { catalogTag, pluralTag, messages, fallback } = options
  const rtlText = isRtlTag(catalogTag)
  let failureCode: string | null = null
  const t = createTranslator({
    // Plurals format under the exact data tag, so the polyfill never has to
    // match a tag it has no data for (KTD1).
    locale: pluralTag,
    messages: messages as AbstractIntlMessages,
    onError: (error) => {
      failureCode = error.code
    },
    getMessageFallback: () => FAILED,
  }) as unknown as LooseTranslate

  function attempt(key: string, values?: TranslationValues): string | null {
    failureCode = null
    const message = messageAt(messages, key)
    const prepared =
      message === undefined ? values : isolateValues(message, values, rtlText)
    const text = t(key, prepared)
    return text === FAILED ? null : text
  }

  return {
    catalogTag,
    pluralTag,
    translate(key, values) {
      const text = attempt(key, values)
      if (text !== null) return text
      reportMessageError(key, catalogTag, failureCode ?? "UNKNOWN")
      return fallback ? fallback().translate(key, values) : key
    },
    has: (key) => t.has(key),
  }
}

// Parallel strings: each plain letter maps to the accented letter at its index.
const PLAIN_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
const ACCENTED_LETTERS = "àƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ"

// Development-only pseudo-locale: accented, bracketed, and about 40% longer, so
// clipped or hard-coded text stands out. ICU syntax and arguments stay intact.
function pseudoLocalizeMessage(message: string): string {
  let ast: MessageFormatElement[]
  try {
    ast = parse(message)
  } catch {
    return message
  }
  let letters = 0
  const walk = (elements: MessageFormatElement[]): MessageFormatElement[] =>
    elements.map((element) => {
      if (isLiteralElement(element)) {
        letters += element.value.length
        const value = element.value.replace(
          /[A-Za-z]/g,
          (c) => ACCENTED_LETTERS[PLAIN_LETTERS.indexOf(c)],
        )
        return { ...element, value }
      }
      if (isPluralElement(element) || isSelectElement(element)) {
        const options = Object.fromEntries(
          Object.entries(element.options).map(([selector, option]) => [
            selector,
            { ...option, value: walk(option.value) },
          ]),
        )
        return { ...element, options }
      }
      if (isTagElement(element)) {
        return { ...element, children: walk(element.children) }
      }
      return element
    })
  const body = printAST(walk(ast))
  return `[${body} ${"~".repeat(Math.ceil(letters * 0.4))}]`
}

export function pseudoLocalizeMessages(
  messages: CatalogMessages,
): CatalogMessages {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      typeof value === "string"
        ? pseudoLocalizeMessage(value)
        : value !== null && typeof value === "object"
          ? pseudoLocalizeMessages(value as CatalogMessages)
          : value,
    ]),
  )
}
