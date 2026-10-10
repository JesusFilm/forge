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
}

export const PRODUCTION_CANDIDATE_BENCHMARK_CASES: readonly CandidateBenchmarkCase[] =
  [
    {
      id: "jesus-japanese-mixed",
      query: "Jesus Japanese",
      locale: "ja",
      languageSlug: "japanese",
      slices: ["exact-title", "mixed-language", "broad-title"],
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
    },
    {
      id: "jesus-chinese-traditional",
      query: "耶穌",
      locale: "zh-Hant",
      languageSlug: "mandarin-china",
      slices: ["exact-title", "native-title", "language-correctness"],
    },
    {
      id: "jesus-japanese-native",
      query: "イエス",
      locale: "ja",
      languageSlug: "japanese",
      slices: ["exact-title", "native-title", "language-correctness"],
    },
    {
      id: "jesus-russian-native",
      query: "Иисус",
      locale: "ru",
      languageSlug: "russian",
      slices: ["exact-title", "native-title", "language-correctness"],
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
    },
    {
      id: "jesus-latin-exact",
      query: "JESUS",
      locale: "en",
      languageSlug: "english",
      slices: ["exact-title", "native-title", "duplicate-title"],
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
  ] as const
