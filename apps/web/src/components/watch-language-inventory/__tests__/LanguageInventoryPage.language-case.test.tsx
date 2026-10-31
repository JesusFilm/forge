// @vitest-environment jsdom
//
// QA N48a: the language name inside the library heading. Admin stores native
// names capitalised ("Español"); Spanish, French, Italian and Portuguese write
// language names in lower case mid-sentence, German and English do not.
//
// These tests run against the REAL production catalogs (`messages/<locale>.json`)
// through next-intl's real translator, not the shared setup's four-locale mock,
// so the casing result depends on what each locale's template actually says.

import type { Route } from "next"
import type { AbstractIntlMessages } from "next-intl"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import az from "../../../../messages/az.json"
import de from "../../../../messages/de.json"
import en from "../../../../messages/en.json"
import es from "../../../../messages/es.json"
import fr from "../../../../messages/fr.json"
import itMessages from "../../../../messages/it.json"
import pt from "../../../../messages/pt.json"
import ru from "../../../../messages/ru.json"

const catalogs: Record<string, AbstractIntlMessages> = {
  az,
  de,
  en,
  es,
  fr,
  it: itMessages,
  pt,
  ru,
}
const { createTranslator } =
  await vi.importActual<typeof import("next-intl")>("next-intl")
const state = vi.hoisted(() => ({ locale: "en" }))

vi.mock("next/image", () => ({ default: () => null }))
vi.mock("../LanguageCollectionSwitcher", () => ({
  LanguageCollectionSwitcher: () => null,
}))
vi.mock("next-intl", () => ({
  useLocale: () => state.locale,
  useTranslations: (namespace: string) =>
    createTranslator({
      locale: state.locale,
      namespace,
      messages: catalogs[state.locale],
      onError() {},
    }),
  useFormatter: () => ({
    dateTime: (value: Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(state.locale, options).format(value),
    number: (value: number) =>
      new Intl.NumberFormat(state.locale).format(value),
  }),
}))

import { LanguageInventoryPage } from "../LanguageInventoryPage"
import type {
  WatchLanguageInventoryCard,
  WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"

function card(
  id: string,
  availability: WatchLanguageInventoryCard["availability"],
): WatchLanguageInventoryCard {
  return {
    id,
    coreId: id,
    slug: id,
    title: id,
    description: null,
    imageUrl: null,
    imageAlt: id,
    muxPlaybackId: null,
    label: "SHORT_FILM",
    availability,
    href: `/${id}.html` as Route,
    watchLanguageSlug: "language",
    parentSlug: null,
    parentTitle: null,
    parentOrder: null,
    durationSeconds: 60,
    childCount: 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
  }
}

function inventory(
  languageName: string,
  languageNativeName: string,
): WatchLanguageInventoryModel {
  return {
    languageSlug: "language",
    languageName,
    languageNativeName,
    switcherLanguages: [],
    counts: {
      audioCollections: 0,
      audioVideos: 1,
      subtitleOnlyVideos: 1,
      total: 2,
    },
    promoted: [],
    audioCollections: [],
    audioVideos: [card("dubbed", "AUDIO")],
    subtitleOnlyVideos: [card("subbed", "SUBTITLE_ONLY")],
    collectionLanguageCounts: {},
  }
}

function render(locale: string, model: WatchLanguageInventoryModel) {
  state.locale = locale
  const html = renderToStaticMarkup(<LanguageInventoryPage inventory={model} />)
  return new DOMParser().parseFromString(html, "text/html")
}

function h1(locale: string, model: WatchLanguageInventoryModel): string {
  return render(locale, model).querySelector("h1")?.textContent ?? ""
}

describe("inventory heading language-name casing (N48a)", () => {
  it("lower-cases the language name mid-sentence in Spanish", () => {
    expect(h1("es", inventory("Spanish", "Español"))).toBe(
      "Videos cristianos gratuitos en español",
    )
  })

  it("keeps German and English capitalised", () => {
    expect(h1("de", inventory("German", "Deutsch"))).toBe(
      "Kostenlose christliche Videos in Deutsch",
    )
    expect(h1("en", inventory("English", "English"))).toBe(
      "Free Christian videos in English",
    )
  })

  it.each([
    ["fr", "French", "Français", "Vidéos chrétiennes gratuites en français"],
    ["it", "Italian", "Italiano", "Video cristiani gratuiti in italiano"],
    ["pt", "Portuguese", "Português", "Vídeos cristãos gratuitos em português"],
    [
      "ru",
      "Russian",
      "Русский",
      "Бесплатные христианские видео. Язык: русский",
    ],
  ])("lower-cases the in-sentence name in %s", (locale, name, native, text) => {
    expect(h1(locale, inventory(name, native))).toBe(text)
  })

  it("never rewrites a language that is not the UI language", () => {
    expect(h1("es", inventory("French", "Français"))).toBe(
      "Videos cristianos gratuitos en Français",
    )
    // Nor a regional variant that merely resembles the UI locale.
    expect(
      h1("es", inventory("Spanish, Latin American", "Español latinoamericano")),
    ).toBe("Videos cristianos gratuitos en Español latinoamericano")
  })

  it("keeps the capital where the template opens with the language name", () => {
    // az heroTitle starts with `{language}`; lower-casing would break the sentence.
    expect(az.LanguageInventory.heroTitle.startsWith("{language}")).toBe(true)
    expect(
      h1("az", inventory("Azerbaijani", "Azərbaycan")).startsWith("Azərbaycan"),
    ).toBe(true)
  })

  it("decides casing per template, not per page", () => {
    // Same page, same language: the az hero opens with {language} (capital) but
    // the dubbed-section title places it mid-sentence (lower case). Passing the
    // wrong catalog key to the helper would flip one of the two.
    const doc = render("az", inventory("Azerbaijani", "Azərbaycan"))
    expect(doc.querySelector("h1")?.textContent).toBe(
      "Azərbaycan dilində pulsuz xristian videoları",
    )
    expect(doc.body.textContent).toContain(
      "Kolleksiyalara görə azərbaycan videoları",
    )
  })

  it("applies the same casing to the hero copy and both section headings", () => {
    const doc = render("es", inventory("Spanish", "Español"))
    const text = doc.body.textContent ?? ""
    expect(text).toContain("Videos en español por colección")
    expect(text).toContain("Videos en español con subtítulos")
    expect(text).toContain("disponibles en español.")
    expect(text).not.toContain("Español")
  })
})
