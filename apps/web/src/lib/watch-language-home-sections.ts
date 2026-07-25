import { resolveWatchHome, type WatchHomeSection } from "@/lib/watch-home"

function withLanguageSlug(href: string | null, languageSlug: string) {
  if (!href) return href
  return href.replace(/\/[^/?#]+\.html(?=([?#]|$))/, `/${languageSlug}.html`)
}

function localizeHomeSections(
  sections: WatchHomeSection[],
  languageSlug: string,
): WatchHomeSection[] {
  return sections.map((section) => ({
    ...section,
    cards: section.cards.map((card) => ({
      ...card,
      href: withLanguageSlug(card.href, languageSlug),
    })),
  }))
}

export async function resolveLanguageHomeSections(
  locale: string,
  languageSlug: string,
): Promise<WatchHomeSection[]> {
  const exact = await resolveWatchHome(locale, languageSlug)
  if (exact.data?.sections.length) return exact.data.sections

  const fallback = await resolveWatchHome(locale)
  return fallback.data?.sections.length
    ? localizeHomeSections(fallback.data.sections, languageSlug)
    : []
}
