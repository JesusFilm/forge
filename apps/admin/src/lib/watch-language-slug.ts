// SYNC: mirrors PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE in
// apps/web/src/lib/locale.ts. Admin preview and operator links must use the
// public audio-language slug, not the Experience locale key.
const WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE: Readonly<Record<string, string>> = {
  en: "english",
  es: "spanish-castilian",
  fr: "french",
  pt: "portuguese-brazil",
  de: "german-standard",
  ar: "arabic-modern-standard",
  id: "indonesian-isa",
  ja: "japanese",
  ko: "korean",
  ms: "malay",
  ne: "nepali",
  ru: "russian",
  th: "thai",
  tl: "tagalog",
  tr: "turkish",
  vi: "vietnamese",
  zh: "mandarin-china",
  "zh-hans": "chinese-simplified",
  "zh-hant": "chinese-traditional",
}

export function watchLanguageSlugForLocale(locale: string): string | null {
  const normalized = locale
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!normalized) return null

  return (
    WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE[normalized] ??
    WATCH_AUDIO_LANGUAGE_SLUG_BY_LOCALE[normalized.split("-")[0] ?? ""] ??
    null
  )
}
