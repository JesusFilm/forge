import {
  WATCH_SEARCH_INTENT_EVAL_CASES,
  type WatchSearchCandidateEvalTrack,
  type WatchSearchCandidateJudgment,
} from "./watch-search-candidate-intent-eval-cases"

export const REQUIRED_CANDIDATE_BENCHMARK_SLICES = [
  "exact-title",
  "partial-title",
  "punctuation-title",
  "typo-title",
  "duplicate-title",
  "no-result",
  "language-correctness",
  "mixed-language",
  "native-title",
  "topical",
  "semantic",
  "broad-title",
] as const

export type CandidateBenchmarkSlice =
  (typeof REQUIRED_CANDIDATE_BENCHMARK_SLICES)[number]

export type CandidateBenchmarkCase = {
  id: string
  query: string
  locale?: string
  languageSlug?: string
  slices: readonly CandidateBenchmarkSlice[]
  track?: WatchSearchCandidateEvalTrack
  judgment?: WatchSearchCandidateJudgment
}

export const REQUIRED_CANDIDATE_JUDGED_CASES = [
  { id: "jesus-japanese-mixed", track: "exact-title" },
  { id: "jesus-chinese-native", track: "exact-title" },
  { id: "jesus-chinese-traditional", track: "exact-title" },
  { id: "jesus-japanese-native", track: "exact-title" },
  { id: "jesus-russian-native", track: "exact-title" },
  { id: "jesus-arabic-native", track: "exact-title" },
  { id: "jesus-latin-exact", track: "exact-title" },
  ...WATCH_SEARCH_INTENT_EVAL_CASES.map(({ id, track }) => ({ id, track })),
] as const satisfies readonly {
  id: string
  track: WatchSearchCandidateEvalTrack
}[]

function exactTitleJudgment(
  languageSlug: string,
): WatchSearchCandidateJudgment {
  return {
    expectedCanonicalSlugs: ["jesus"],
    acceptableAlternateSlugs: [],
    maxRank: 1,
    allowedAvailabilityKinds: ["target_audio"],
    allowedContentTypes: ["FEATURE_FILM"],
    allowedLanguageSlugs: [languageSlug],
    requiresPlayback: true,
  }
}

export const PRODUCTION_CANDIDATE_BENCHMARK_CASES: readonly CandidateBenchmarkCase[] =
  [
    {
      id: "jesus-japanese-mixed",
      query: "Jesus Japanese",
      locale: "ja",
      languageSlug: "japanese",
      slices: ["exact-title", "mixed-language", "broad-title"],
      track: "exact-title",
      judgment: exactTitleJudgment("japanese"),
    },
    {
      id: "jesus-chinese-native",
      query: "耶稣",
      locale: "zh-Hans",
      languageSlug: "mandarin-china",
      slices: [
        "exact-title",
        "native-title",
        "broad-title",
        "language-correctness",
      ],
      track: "exact-title",
      judgment: exactTitleJudgment("mandarin-china"),
    },
    {
      id: "jesus-chinese-traditional",
      query: "耶穌",
      locale: "zh-Hant",
      languageSlug: "mandarin-china",
      slices: ["exact-title", "native-title", "language-correctness"],
      track: "exact-title",
      judgment: exactTitleJudgment("mandarin-china"),
    },
    {
      id: "jesus-japanese-native",
      query: "イエス",
      locale: "ja",
      languageSlug: "japanese",
      slices: ["exact-title", "native-title", "language-correctness"],
      track: "exact-title",
      judgment: exactTitleJudgment("japanese"),
    },
    {
      id: "jesus-russian-native",
      query: "Иисус",
      locale: "ru",
      languageSlug: "russian",
      slices: ["exact-title", "native-title", "language-correctness"],
      track: "exact-title",
      judgment: exactTitleJudgment("russian"),
    },
    {
      id: "jesus-arabic-native",
      query: "يسوع",
      locale: "ar",
      languageSlug: "arabic-modern-standard",
      slices: [
        "exact-title",
        "native-title",
        "broad-title",
        "language-correctness",
      ],
      track: "exact-title",
      judgment: exactTitleJudgment("arabic-modern-standard"),
    },
    {
      id: "jesus-latin-exact",
      query: "JESUS",
      locale: "en",
      languageSlug: "english",
      slices: ["exact-title", "native-title", "duplicate-title"],
      track: "exact-title",
      judgment: exactTitleJudgment("english"),
    },
    {
      id: "jesus-russian-partial",
      query: "Иис",
      locale: "ru",
      languageSlug: "russian",
      slices: ["partial-title", "language-correctness"],
    },
    {
      id: "jesus-chinese-punctuation",
      query: "《耶稣》",
      locale: "zh-Hans",
      languageSlug: "mandarin-china",
      slices: ["punctuation-title", "language-correctness"],
    },
    {
      id: "jesus-latin-typo",
      query: "JESUSS",
      locale: "en",
      languageSlug: "english",
      slices: ["typo-title"],
    },
    {
      id: "deliberate-no-result",
      query: "zxqv no matching watch title 7319",
      locale: "en",
      languageSlug: "english",
      slices: ["no-result"],
    },
    {
      id: "forgiveness-spanish-topic",
      query: "perdón después del fracaso",
      locale: "es",
      languageSlug: "spanish-latin-america",
      slices: ["topical"],
    },
    {
      id: "hope-when-heavy-semantic",
      query: "finding hope when life feels heavy",
      locale: "en",
      languageSlug: "english",
      slices: ["semantic"],
    },
    ...WATCH_SEARCH_INTENT_EVAL_CASES.map((evalCase) => ({
      ...evalCase,
      slices: ["semantic"] as const,
    })),
  ] as const
