import type { WatchSearchAvailabilityKind } from "@/services/watch-search.service"

export const WATCH_SEARCH_COMMON_PHRASE_QRELS_REVISION =
  "watch-search-common-phrases/v1"

export type WatchSearchCandidateEvalTrack = "exact-title" | "intent-query"

export type WatchSearchCandidateJudgment = {
  expectedCanonicalSlugs: readonly string[]
  acceptableCanonicalSlugs: readonly string[]
  maxRank: number
  requiredAlternate?: {
    slugs: readonly string[]
    maxRank: number
  }
  allowedAvailabilityKinds: readonly WatchSearchAvailabilityKind[]
  allowedContentTypes: readonly string[]
  allowedLanguageSlugs: readonly string[]
  requiresPlayback: boolean
}

type WatchSearchCandidateEvalCase = {
  id: string
  query: string
  locale: string
  languageSlug: string
  track: WatchSearchCandidateEvalTrack
  judgment: WatchSearchCandidateJudgment
}

const ENGLISH_TARGET_AUDIO = {
  allowedAvailabilityKinds: ["target_audio"],
  allowedLanguageSlugs: ["english"],
  requiresPlayback: true,
} as const

export const WATCH_SEARCH_INTENT_EVAL_CASES = [
  {
    id: "jesus-for-kids",
    query: "Jesus for kids",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["the-story-of-jesus-for-children"],
      acceptableCanonicalSlugs: [],
      maxRank: 1,
      requiredAlternate: {
        slugs: ["storyclubs-childhood-of-jesus"],
        maxRank: 5,
      },
      allowedContentTypes: ["FEATURE_FILM"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "jesus-for-children",
    query: "Jesus for children",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["the-story-of-jesus-for-children"],
      acceptableCanonicalSlugs: [],
      maxRank: 1,
      requiredAlternate: {
        slugs: ["storyclubs-childhood-of-jesus"],
        maxRank: 5,
      },
      allowedContentTypes: ["FEATURE_FILM"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "resurrection",
    query: "resurrection",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["31-was-jesus-resurrection-fake-news"],
      acceptableCanonicalSlugs: [
        "3-the-meaning-of-the-resurrection--episode-3",
        "episode-2-i-am-the-resurrection",
      ],
      maxRank: 3,
      allowedContentTypes: ["EPISODE"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "forgiveness",
    query: "forgiveness",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["forgiveness"],
      acceptableCanonicalSlugs: [
        "forgiveness-vertical",
        "2-walking-in-forgiveness",
      ],
      maxRank: 3,
      allowedContentTypes: ["EPISODE"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "prayer",
    query: "prayer",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["prayer-talking-to-god"],
      acceptableCanonicalSlugs: ["9-prayer", "41-what-is-prayer"],
      maxRank: 3,
      allowedContentTypes: ["EPISODE"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "anxiety",
    query: "anxiety",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["day-3-anxiety"],
      acceptableCanonicalSlugs: ["day-23-prayer-and-anxiety"],
      maxRank: 2,
      allowedContentTypes: ["EPISODE"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "christmas",
    query: "Christmas",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["a-supreme-christmas"],
      acceptableCanonicalSlugs: [
        "22-what-is-the-meaning-of-christmas",
        "21-what-is-the-origin-of-christmas",
        "the-meaning-of-christmas--episode-3",
        "the-unexpected-christmas--episode-2",
        "origins-of-christmas--episode-1",
      ],
      maxRank: 10,
      allowedContentTypes: ["SHORT_FILM", "EPISODE"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "prodigal-son",
    query: "prodigal son",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["the-prodigal"],
      acceptableCanonicalSlugs: ["brothers", "in-the-family"],
      maxRank: 10,
      allowedContentTypes: ["SHORT_FILM", "EPISODE"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "who-is-jesus",
    query: "who is Jesus",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["who-is-jesus"],
      acceptableCanonicalSlugs: ["who-is-jesusreally"],
      maxRank: 2,
      allowedContentTypes: ["EPISODE", "SHORT_FILM"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
  {
    id: "life-after-death",
    query: "life after death",
    locale: "en",
    languageSlug: "english",
    track: "intent-query",
    judgment: {
      expectedCanonicalSlugs: ["3-life-after-death"],
      acceptableCanonicalSlugs: ["fallingplates"],
      maxRank: 2,
      allowedContentTypes: ["EPISODE", "SHORT_FILM"],
      ...ENGLISH_TARGET_AUDIO,
    },
  },
] as const satisfies readonly WatchSearchCandidateEvalCase[]

export class WatchSearchCandidateEvalConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchCandidateEvalConfigurationError"
  }
}

function nonemptyStrings(value: unknown, name: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    throw new WatchSearchCandidateEvalConfigurationError(
      `${name} must be a non-empty string list`,
    )
  }
  return value
}

export function validateWatchSearchCandidateEvalCases(
  cases: readonly WatchSearchCandidateEvalCase[],
): void {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new WatchSearchCandidateEvalConfigurationError(
      "watch search Candidate evaluation cases are required",
    )
  }
  const ids = new Set<string>()
  const queries = new Set<string>()
  for (const evalCase of cases) {
    if (!evalCase || typeof evalCase !== "object") {
      throw new WatchSearchCandidateEvalConfigurationError(
        "watch search Candidate evaluation case is malformed",
      )
    }
    if (!evalCase.id?.trim() || ids.has(evalCase.id)) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `duplicate or missing evaluation case id: ${evalCase.id}`,
      )
    }
    ids.add(evalCase.id)
    const queryKey = `${evalCase.track}:${evalCase.query?.trim().toLocaleLowerCase("en")}`
    if (!evalCase.query?.trim() || queries.has(queryKey)) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `duplicate or missing evaluation query: ${evalCase.query}`,
      )
    }
    queries.add(queryKey)
    if (!evalCase.locale?.trim() || !evalCase.languageSlug?.trim()) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id} must declare locale and language`,
      )
    }
    if (evalCase.track !== "exact-title" && evalCase.track !== "intent-query") {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id} has an invalid evaluation track`,
      )
    }
    const expected = nonemptyStrings(
      evalCase.judgment?.expectedCanonicalSlugs,
      `${evalCase.id}.expectedCanonicalSlugs`,
    )
    const acceptableCanonicalSlugs = Array.isArray(
      evalCase.judgment?.acceptableCanonicalSlugs,
    )
      ? evalCase.judgment.acceptableCanonicalSlugs
      : []
    if (
      acceptableCanonicalSlugs.some(
        (slug: unknown) => typeof slug !== "string" || slug.trim().length === 0,
      )
    ) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id}.acceptableCanonicalSlugs is malformed`,
      )
    }
    const requiredAlternateSlugs = evalCase.judgment.requiredAlternate?.slugs
    if (
      requiredAlternateSlugs != null &&
      (!Array.isArray(requiredAlternateSlugs) ||
        requiredAlternateSlugs.length === 0 ||
        requiredAlternateSlugs.some(
          (slug: unknown) =>
            typeof slug !== "string" || slug.trim().length === 0,
        ))
    ) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id}.requiredAlternate.slugs is malformed`,
      )
    }
    const slugs = [
      ...expected,
      ...acceptableCanonicalSlugs,
      ...(requiredAlternateSlugs ?? []),
    ]
    if (new Set(slugs).size !== slugs.length) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id} contains duplicate judgment slugs`,
      )
    }
    if (
      !Number.isSafeInteger(evalCase.judgment?.maxRank) ||
      evalCase.judgment.maxRank < 1
    ) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id}.maxRank must be a positive integer`,
      )
    }
    if (
      evalCase.judgment.requiredAlternate != null &&
      (!Number.isSafeInteger(evalCase.judgment.requiredAlternate.maxRank) ||
        evalCase.judgment.requiredAlternate.maxRank < 1)
    ) {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id}.requiredAlternate.maxRank must be a positive integer`,
      )
    }
    nonemptyStrings(
      evalCase.judgment.allowedAvailabilityKinds,
      `${evalCase.id}.allowedAvailabilityKinds`,
    )
    nonemptyStrings(
      evalCase.judgment.allowedContentTypes,
      `${evalCase.id}.allowedContentTypes`,
    )
    nonemptyStrings(
      evalCase.judgment.allowedLanguageSlugs,
      `${evalCase.id}.allowedLanguageSlugs`,
    )
    if (typeof evalCase.judgment.requiresPlayback !== "boolean") {
      throw new WatchSearchCandidateEvalConfigurationError(
        `${evalCase.id}.requiresPlayback must be boolean`,
      )
    }
  }
}

validateWatchSearchCandidateEvalCases(WATCH_SEARCH_INTENT_EVAL_CASES)
