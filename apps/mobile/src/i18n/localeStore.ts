// KTD2: module-scope state with an English default, so a suite that sets no
// locale needs no provider. The lazy requires are the design (KTD1, KTD3):
// each sits in a `try`, so a missing native module or polyfill keeps English.
/* eslint-disable @typescript-eslint/no-require-imports */
import { AppState } from "react-native"
import type { Locale as PhoneLocale } from "expo-localization"

import { audioSlugForLocaleTag } from "./audioSlug"
import {
  CATALOG_LOADERS,
  CATALOG_TAGS,
  type CatalogTag,
} from "./catalogs.generated"
import { PLURAL_DATA_TAG } from "./pluralData.generated"
import {
  DEFAULT_LOCALE,
  resolveLocale,
  type LocaleMatch,
} from "./resolveLocale"
import {
  createUiTranslator,
  pseudoLocalizeMessages,
  type CatalogMessages,
  type UiTranslator,
} from "./translator"

export type { PhoneLocale }

export type LocaleResolution = {
  /** The catalog in use; `en` under the pseudo-locale. */
  tag: CatalogTag
  /** The phone's language tags, in preference order. */
  requested: readonly string[]
  match: LocaleMatch | "default" | "error" | "pseudo"
  /** Index into `requested` of the entry that matched; -1 otherwise. */
  matchedIndex: number
  /** Why the store kept English at start, or null. */
  errorReason: string | null
  /** Why the native locale event is not wired, or null. */
  listenerErrorReason: string | null
  /** Why the plural polyfill or its data did not load, or null. */
  pluralErrorReason: string | null
}

const ENGLISH = DEFAULT_LOCALE as CatalogTag

// Metro inlines EXPO_PUBLIC_ values only at module scope.
const PSEUDO_LOCALE_ENV = process.env.EXPO_PUBLIC_UI_PSEUDO_LOCALE

const MAX_REASON_LENGTH = 200

type Subscription = { remove(): void }

function initialResolution(): LocaleResolution {
  return {
    tag: ENGLISH,
    requested: [],
    match: "default",
    matchedIndex: -1,
    errorReason: null,
    listenerErrorReason: null,
    pluralErrorReason: null,
  }
}

let epoch = 0
let catalogTag: CatalogTag = ENGLISH
let active: UiTranslator | null = null
let english: UiTranslator | null = null
let phoneLocales: readonly PhoneLocale[] = []
let resolution: LocaleResolution = initialResolution()
let started = false
let pseudo = false
let subscriptions: Subscription[] = []
const listeners = new Set<() => void>()

function describeError(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return text.slice(0, MAX_REASON_LENGTH)
}

/** Development only, and only for an exact opt-in value. */
export function isPseudoLocaleRequested(
  dev: boolean,
  raw: string | undefined,
): boolean {
  return dev && (raw === "1" || raw === "true")
}

function hasNativePlurals(): boolean {
  return (
    typeof Intl.PluralRules === "function" && typeof Intl.Locale === "function"
  )
}

// Before start, an engine with both APIs (Node under jest) keeps its own; from
// start on, the forced polyfill runs (KTD1). A failure is recorded, not thrown:
// a plural then falls back, but the render survives.
function loadPlurals(dataTag: string): void {
  if (!started && hasNativePlurals()) return
  try {
    const { loadPluralData } =
      require("./pluralRules") as typeof import("./pluralRules")
    loadPluralData(dataTag)
  } catch (error) {
    resolution = {
      ...resolution,
      pluralErrorReason: resolution.pluralErrorReason ?? describeError(error),
    }
  }
}

function loadCatalog(tag: CatalogTag): CatalogMessages {
  return CATALOG_LOADERS[tag]() as CatalogMessages
}

/** The English catalog loads on the first missing key, not before (R8). */
function englishTranslator(): UiTranslator {
  if (!english) {
    loadPlurals(ENGLISH)
    english = createUiTranslator({
      catalogTag: ENGLISH,
      pluralTag: ENGLISH,
      messages: loadCatalog(ENGLISH),
      fallback: null,
    })
  }
  return english
}

function createTranslatorFor(tag: CatalogTag): UiTranslator {
  if (pseudo) {
    loadPlurals(ENGLISH)
    return createUiTranslator({
      catalogTag: ENGLISH,
      pluralTag: ENGLISH,
      messages: pseudoLocalizeMessages(loadCatalog(ENGLISH)),
      fallback: englishTranslator,
    })
  }
  if (tag === ENGLISH) return englishTranslator()
  const pluralTag = PLURAL_DATA_TAG[tag]
  loadPlurals(pluralTag)
  return createUiTranslator({
    catalogTag: tag,
    pluralTag,
    messages: loadCatalog(tag),
    fallback: englishTranslator,
  })
}

type PhoneRead = { locales: readonly PhoneLocale[] } | { reason: string }

/** Carries a reason that is already described. */
class LocaleReadError extends Error {}

function readPhoneLocales(): PhoneRead {
  try {
    // KTD3: a lazy require, so a dev client built before this native module
    // was added stays on English instead of failing at start.
    const localization =
      require("expo-localization") as typeof import("expo-localization")
    const locales: unknown = localization.getLocales()
    if (!Array.isArray(locales)) {
      return { reason: "getLocales returned no list" }
    }
    return { locales }
  } catch (error) {
    return { reason: describeError(error) }
  }
}

function tagsOf(locales: readonly PhoneLocale[]): string[] {
  return locales
    .map((locale: PhoneLocale | null) => locale?.languageTag)
    .filter((tag): tag is string => typeof tag === "string")
}

function resolveFromPhone(
  requested: readonly string[],
): Pick<LocaleResolution, "tag" | "match" | "matchedIndex"> {
  if (pseudo) return { tag: ENGLISH, match: "pseudo", matchedIndex: -1 }
  const result = resolveLocale(requested, CATALOG_TAGS)
  return {
    tag: result.tag as CatalogTag,
    match: result.match,
    matchedIndex: result.matchedIndex,
  }
}

function registerListeners(): void {
  try {
    subscriptions.push(
      AppState.addEventListener("change", (state) => {
        if (state === "active") refreshLocale()
      }),
    )
  } catch (error) {
    resolution = { ...resolution, listenerErrorReason: describeError(error) }
  }
  try {
    // The public entry does not export addLocaleListener (KTD3); the start-up
    // guard pins this path so a package bump that moves it fails a test.
    const { addLocaleListener } =
      require("expo-localization/build/ExpoLocalization") as typeof import("expo-localization/build/ExpoLocalization")
    subscriptions.push(addLocaleListener(() => refreshLocale()))
  } catch (error) {
    resolution = { ...resolution, listenerErrorReason: describeError(error) }
  }
}

// KTD3: once, at module scope in app/_layout.tsx, before the first render. It
// loads English plural data first, then sets the matched catalog with epoch 0,
// so no listener fires. A failure keeps English and records the reason.
export function startLocaleSync(options: { pseudo?: boolean } = {}): void {
  if (started) return
  started = true
  pseudo =
    __DEV__ &&
    (options.pseudo ?? isPseudoLocaleRequested(__DEV__, PSEUDO_LOCALE_ENV))
  loadPlurals(ENGLISH)
  try {
    const read = readPhoneLocales()
    if ("reason" in read) throw new LocaleReadError(read.reason)
    phoneLocales = read.locales
    const requested = tagsOf(read.locales)
    const resolved = resolveFromPhone(requested)
    resolution = { ...resolution, requested }
    active = createTranslatorFor(resolved.tag)
    catalogTag = resolved.tag
    resolution = { ...resolution, ...resolved }
  } catch (error) {
    active = null
    catalogTag = ENGLISH
    resolution = {
      ...resolution,
      tag: ENGLISH,
      match: "error",
      matchedIndex: -1,
      errorReason:
        error instanceof LocaleReadError ? error.message : describeError(error),
    }
  }
  registerListeners()
}

// Runs on a foreground return and on the native locale event. Idempotent: the
// epoch moves only when the catalog tag changes; a failed read changes nothing.
export function refreshLocale(): void {
  if (!started) return
  const read = readPhoneLocales()
  if ("reason" in read) return
  let requested: string[]
  let resolved: ReturnType<typeof resolveFromPhone>
  let next: UiTranslator | null = null
  try {
    requested = tagsOf(read.locales)
    resolved = resolveFromPhone(requested)
    if (resolved.tag !== catalogTag) next = createTranslatorFor(resolved.tag)
  } catch {
    return
  }
  phoneLocales = read.locales
  if (!next) {
    resolution = { ...resolution, ...resolved, requested }
    return
  }
  active = next
  catalogTag = resolved.tag
  resolution = { ...resolution, ...resolved, requested }
  epoch += 1
  listeners.forEach((listener) => listener())
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The change signal and stale-response guard. Never a cache key (KTD2). */
export function getLocaleEpoch(): number {
  return epoch
}

/** The catalog tag in use, e.g. `zh-Hans`. */
export function getCatalogTag(): CatalogTag {
  return catalogTag
}

/** The raw `getLocales()` result from the last read; empty before start. */
export function getPhoneLocales(): readonly PhoneLocale[] {
  return phoneLocales
}

export type DefaultAudioLanguage = {
  /** The phone's first language tag, as the phone sends it (`es-MX`). */
  tag: string
  /** Its Language slug, or null when no table entry maps the tag. */
  slug: string | null
}

/**
 * KTD12: the default audio, subtitle, Bible, For You, and Explore language.
 * It is the phone's first language, before any catalog fallback. Null before
 * the first read, or when the list is empty (a dev client without the module).
 */
export function defaultAudioLanguage(): DefaultAudioLanguage | null {
  const tag = tagsOf(phoneLocales).find((value) => value.trim() !== "")
  if (tag === undefined) return null
  return { tag, slug: audioSlugForLocaleTag(tag) }
}

export function getLocaleResolution(): LocaleResolution {
  return resolution
}

export function isPseudoLocale(): boolean {
  return pseudo
}

/** The translator for the catalog in use, built on first use. */
export function getActiveTranslator(): UiTranslator {
  active ??= createTranslatorFor(catalogTag)
  return active
}

type LocaleAttributes = {
  "ui_locale.resolved": string
  "ui_locale.requested": string
  "ui_locale.fallback": string
  "ui_locale.error_reason"?: string
  "ui_locale.listener_error"?: string
  "ui_locale.plural_error"?: string
}

function fallbackKind(r: LocaleResolution): string {
  if (r.match === "error" || r.match === "pseudo") return r.match
  if (r.match === "default") return "english"
  if (r.matchedIndex > 0) return "later_preference"
  return r.match === "exact" ? "none" : r.match
}

/** Context for the `ui_locale.resolved` log. Never a reserved Datadog name. */
export function localeResolutionAttributes(
  r: LocaleResolution,
): LocaleAttributes {
  const attributes: LocaleAttributes = {
    "ui_locale.resolved": r.tag,
    "ui_locale.requested": r.requested[0] ?? "",
    "ui_locale.fallback": fallbackKind(r),
  }
  if (r.errorReason) attributes["ui_locale.error_reason"] = r.errorReason
  if (r.listenerErrorReason) {
    attributes["ui_locale.listener_error"] = r.listenerErrorReason
  }
  if (r.pluralErrorReason) {
    attributes["ui_locale.plural_error"] = r.pluralErrorReason
  }
  return attributes
}

export function resetLocaleStoreForTests(): void {
  subscriptions.forEach((subscription) => subscription.remove())
  subscriptions = []
  listeners.clear()
  epoch = 0
  catalogTag = ENGLISH
  active = null
  english = null
  phoneLocales = []
  resolution = initialResolution()
  started = false
  pseudo = false
}
