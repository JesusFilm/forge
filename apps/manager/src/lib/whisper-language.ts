// BCP-47 → whisper ISO-639-1 language mapping (plan 2026-06-11-002 decision
// 5). Whisper always runs with an EXPLICIT language, never "auto" — an
// unmappable language returns null and the worker degrades to the
// transcription_unsupported_language annotation (same path as no-audio).
//
// The table below is whisper.cpp's documented language list (whisper.cpp
// g_lang / openai-whisper tokenizer LANGUAGES — the large-v3 family,
// including large-v3-turbo, supports all of these). Codes are whisper's own
// tokens, which are MOSTLY ISO-639-1 but carry a few quirks ("jw" for
// Javanese, "haw" for Hawaiian, "yue" for Cantonese) — see the alias map.

const WHISPER_LANGUAGES = new Set([
  "en",
  "zh",
  "de",
  "es",
  "ru",
  "ko",
  "fr",
  "ja",
  "pt",
  "tr",
  "pl",
  "ca",
  "nl",
  "ar",
  "sv",
  "it",
  "id",
  "hi",
  "fi",
  "vi",
  "he",
  "uk",
  "el",
  "ms",
  "cs",
  "ro",
  "da",
  "hu",
  "ta",
  "no",
  "th",
  "ur",
  "hr",
  "bg",
  "lt",
  "la",
  "mi",
  "ml",
  "cy",
  "sk",
  "te",
  "fa",
  "lv",
  "bn",
  "sr",
  "az",
  "sl",
  "kn",
  "et",
  "mk",
  "br",
  "eu",
  "is",
  "hy",
  "ne",
  "mn",
  "bs",
  "kk",
  "sq",
  "sw",
  "gl",
  "mr",
  "pa",
  "si",
  "km",
  "sn",
  "yo",
  "so",
  "af",
  "oc",
  "ka",
  "be",
  "tg",
  "sd",
  "gu",
  "am",
  "yi",
  "lo",
  "uz",
  "fo",
  "ht",
  "ps",
  "tk",
  "nn",
  "mt",
  "sa",
  "lb",
  "my",
  "bo",
  "tl",
  "mg",
  "as",
  "tt",
  "haw",
  "ln",
  "ha",
  "ba",
  "jw",
  "su",
  "yue",
])

// BCP-47 primary subtags whose whisper token differs (whisper quirks +
// canonical BCP-47 tags whose deprecated/legacy form is what whisper uses).
const BCP47_TO_WHISPER_ALIASES: Record<string, string> = {
  jv: "jw", // Javanese — whisper tokenizer uses the legacy "jw"
  nb: "no", // Norwegian Bokmål → whisper's generic "no"
  fil: "tl", // Filipino → whisper's Tagalog token
  iw: "he", // legacy Hebrew tag
  in: "id", // legacy Indonesian tag
  ji: "yi", // legacy Yiddish tag
}

// Maps a BCP-47 tag to whisper's language code: lowercases, strips
// region/script subtags ("pt-BR" → "pt", "zh-Hans-CN" → "zh"), applies the
// alias table, and returns null for anything whisper does not support.
export function toWhisperLanguage(bcp47: string | null): string | null {
  if (bcp47 === null) {
    return null
  }

  const primary = bcp47.trim().toLowerCase().split(/[-_]/, 1)[0]
  if (!primary) {
    return null
  }

  const mapped = BCP47_TO_WHISPER_ALIASES[primary] ?? primary
  return WHISPER_LANGUAGES.has(mapped) ? mapped : null
}
