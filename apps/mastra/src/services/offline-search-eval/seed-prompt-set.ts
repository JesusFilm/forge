import {
  DEFAULT_SEARCH_EVAL_CALLER_TRACK,
  type SearchEvalCallerTrack,
  type SeedPromptCase,
} from "./types"

export const SEARCH_EVAL_SEED_PROMPT_SET_VERSION = "search-eval-seed-prompts/v5"

type SeedPromptInput = Omit<SeedPromptCase, "source" | "callerTracks"> & {
  callerTracks?: readonly SearchEvalCallerTrack[]
}

const ENGLISH = {
  locale: "en",
  languageSlug: "english",
} as const

function seedPrompt(input: SeedPromptInput): SeedPromptCase {
  const { callerTracks, ...caseInput } = input
  return {
    ...caseInput,
    callerTracks: [...(callerTracks ?? [DEFAULT_SEARCH_EVAL_CALLER_TRACK])],
    source: "seed",
  }
}

export const SEARCH_EVAL_SEED_PROMPTS: readonly SeedPromptCase[] = [
  seedPrompt({
    id: "seed-bible-project",
    ...ENGLISH,
    queryText: "bible project",
    tags: ["catalog", "brand-intent", "product-title"],
    operatorNotes:
      "Keyword-first brand/product readiness case: should bring Bible Project videos back.",
  }),
  seedPrompt({
    id: "seed-jesus",
    ...ENGLISH,
    queryText: "jesus",
    tags: ["catalog", "core-title", "product-title", "algolia-top-search"],
    operatorNotes:
      "Algolia top non-empty query for video-variants-prd, 2026-05-22..2026-06-21: count=88, nbHits=395.",
  }),
  seedPrompt({
    id: "seed-who-is-jesus",
    ...ENGLISH,
    queryText: "Who is Jesus?",
    tags: ["question", "new-believer", "bible-topic"],
  }),
  seedPrompt({
    id: "seed-videos-for-teens",
    ...ENGLISH,
    queryText: "videos for teens",
    tags: ["audience", "teens", "felt-need"],
  }),
  seedPrompt({
    id: "seed-resources-for-parents",
    ...ENGLISH,
    queryText: "resources for parents",
    tags: ["audience", "parents", "felt-need"],
  }),
  seedPrompt({
    id: "seed-new-believer",
    ...ENGLISH,
    queryText: "new believer",
    tags: ["discipleship", "new-believer", "felt-need"],
  }),
  seedPrompt({
    id: "seed-small-group-bible-study",
    ...ENGLISH,
    queryText: "small group Bible study",
    tags: ["ministry", "small-group", "felt-need"],
  }),
  seedPrompt({
    id: "seed-church-leader-training",
    ...ENGLISH,
    queryText: "church leader training",
    tags: ["ministry", "leaders", "felt-need"],
  }),
  seedPrompt({
    id: "seed-world-cup",
    ...ENGLISH,
    queryText: "world cup",
    tags: ["algolia-top-search", "confusing", "sports-outreach"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=27, nbHits=6.",
  }),
  seedPrompt({
    id: "seed-walking-with-jesus",
    ...ENGLISH,
    queryText: "walking with jesus",
    tags: ["algolia-top-search", "product-title", "discipleship"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=27, nbHits=5.",
  }),
  seedPrompt({
    id: "seed-jesus-film",
    ...ENGLISH,
    queryText: "jesus film",
    tags: ["algolia-top-search", "product-title", "core-title"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=21, nbHits=98.",
  }),
  seedPrompt({
    id: "seed-lumo",
    ...ENGLISH,
    queryText: "lumo",
    tags: ["algolia-top-search", "product-title"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=20, nbHits=88.",
  }),
  seedPrompt({
    id: "seed-prayer",
    ...ENGLISH,
    queryText: "prayer",
    tags: ["algolia-top-search", "felt-need", "bible-topic"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=17, nbHits=76.",
  }),
  seedPrompt({
    id: "seed-rivka",
    ...ENGLISH,
    queryText: "rivka",
    tags: ["algolia-top-search", "product-title"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=16, nbHits=17.",
  }),
  seedPrompt({
    id: "seed-falling-plates",
    ...ENGLISH,
    queryText: "falling plates",
    tags: ["algolia-top-search", "product-title"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=16, nbHits=1.",
  }),
  seedPrompt({
    id: "seed-children",
    ...ENGLISH,
    queryText: "children",
    tags: ["algolia-top-search", "audience", "children", "synonym"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=16, nbHits=14.",
  }),
  seedPrompt({
    id: "seed-soccer",
    ...ENGLISH,
    queryText: "soccer",
    tags: ["algolia-top-search", "sports-outreach", "synonym"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=16, nbHits=3.",
  }),
  seedPrompt({
    id: "seed-futbol",
    ...ENGLISH,
    queryText: "futbol",
    tags: ["algolia-top-search", "sports-outreach", "synonym", "multilingual"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=13, nbHits=4.",
  }),
  seedPrompt({
    id: "seed-delight",
    ...ENGLISH,
    queryText: "delight",
    tags: ["algolia-top-search", "felt-need", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=13, nbHits=2.",
  }),
  seedPrompt({
    id: "seed-acts",
    ...ENGLISH,
    queryText: "acts",
    tags: ["algolia-top-search", "bible-topic", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=12, nbHits=154.",
  }),
  seedPrompt({
    id: "seed-marathi",
    ...ENGLISH,
    queryText: "marathi",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=12, nbHits=306.",
  }),
  seedPrompt({
    id: "seed-pentecost",
    ...ENGLISH,
    queryText: "pentecost",
    tags: ["algolia-top-search", "bible-topic"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=11, nbHits=3.",
  }),
  seedPrompt({
    id: "seed-matthew",
    ...ENGLISH,
    queryText: "matthew",
    tags: ["algolia-top-search", "bible-topic", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=9, nbHits=42.",
  }),
  seedPrompt({
    id: "seed-good-news",
    ...ENGLISH,
    queryText: "good news",
    tags: ["algolia-top-search", "felt-need", "synonym"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=9, nbHits=98.",
  }),
  seedPrompt({
    id: "seed-the-four",
    ...ENGLISH,
    queryText: "the four",
    tags: ["algolia-top-search", "product-title", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=9, nbHits=549.",
  }),
  seedPrompt({
    id: "seed-ninos",
    locale: "es",
    languageSlug: "spanish-castilian",
    websiteLocale: "en",
    queryText: "ninos",
    tags: [
      "algolia-top-search",
      "multilingual",
      "audience",
      "children",
      "misspelling",
      "mismatch",
    ],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=9, nbHits=17.",
  }),
  seedPrompt({
    id: "seed-love",
    ...ENGLISH,
    queryText: "love",
    tags: ["algolia-top-search", "felt-need", "bible-topic"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=8, nbHits=269.",
  }),
  seedPrompt({
    id: "seed-lozi",
    ...ENGLISH,
    queryText: "lozi",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=8, nbHits=180.",
  }),
  seedPrompt({
    id: "seed-afrikaans",
    ...ENGLISH,
    queryText: "afrikaans",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=8, nbHits=281.",
  }),
  seedPrompt({
    id: "seed-short-films",
    ...ENGLISH,
    queryText: "short films",
    tags: ["algolia-top-search", "catalog", "synonym"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=8, nbHits=41.",
  }),
  seedPrompt({
    id: "seed-birth-of-jesus",
    ...ENGLISH,
    queryText: "birth of jesus",
    tags: ["algolia-top-search", "bible-topic", "scene-like"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=8, nbHits=10.",
  }),
  seedPrompt({
    id: "seed-bible",
    ...ENGLISH,
    queryText: "bible",
    tags: ["algolia-top-search", "catalog", "bible-topic"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=8, nbHits=113.",
  }),
  seedPrompt({
    id: "seed-arabic",
    locale: "ar",
    languageSlug: "arabic-modern-standard",
    websiteLocale: "en",
    queryText: "arabic",
    tags: ["algolia-top-search", "multilingual", "language-name", "mismatch"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=444.",
  }),
  seedPrompt({
    id: "seed-reflection-of-hope",
    ...ENGLISH,
    queryText: "reflection of hope",
    tags: ["algolia-top-search", "product-title", "felt-need"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=10.",
  }),
  seedPrompt({
    id: "seed-punjabi",
    ...ENGLISH,
    queryText: "punjabi",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=225.",
  }),
  seedPrompt({
    id: "seed-considering-christmas",
    ...ENGLISH,
    queryText: "considering christmas",
    tags: ["algolia-top-search", "product-title", "seasonal"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=1.",
  }),
  seedPrompt({
    id: "seed-nua",
    ...ENGLISH,
    queryText: "nua",
    tags: ["algolia-top-search", "product-title"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=94.",
  }),
  seedPrompt({
    id: "seed-luke",
    ...ENGLISH,
    queryText: "luke",
    tags: ["algolia-top-search", "bible-topic", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=156.",
  }),
  seedPrompt({
    id: "seed-farsi",
    ...ENGLISH,
    queryText: "farsi",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=448.",
  }),
  seedPrompt({
    id: "seed-know-god",
    ...ENGLISH,
    queryText: "know god",
    tags: ["algolia-top-search", "felt-need", "new-believer"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=7, nbHits=68.",
  }),
  seedPrompt({
    id: "seed-the-last-supper",
    ...ENGLISH,
    queryText: "the last supper",
    tags: ["algolia-top-search", "bible-topic", "scene-like"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=7.",
  }),
  seedPrompt({
    id: "seed-you-can-talk",
    ...ENGLISH,
    queryText: "you can talk",
    tags: ["algolia-top-search", "product-title", "felt-need"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=16.",
  }),
  seedPrompt({
    id: "seed-bemba",
    ...ENGLISH,
    queryText: "bemba",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=316.",
  }),
  seedPrompt({
    id: "seed-sport",
    ...ENGLISH,
    queryText: "sport",
    tags: ["algolia-top-search", "sports-outreach", "synonym"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=187.",
  }),
  seedPrompt({
    id: "seed-wonder",
    ...ENGLISH,
    queryText: "wonder",
    tags: ["algolia-top-search", "product-title", "felt-need"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=75.",
  }),
  seedPrompt({
    id: "seed-magdalena",
    ...ENGLISH,
    queryText: "magdalena",
    tags: ["algolia-top-search", "product-title"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=56.",
  }),
  seedPrompt({
    id: "seed-my-last-day",
    ...ENGLISH,
    queryText: "my last day",
    tags: ["algolia-top-search", "product-title"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=7.",
  }),
  seedPrompt({
    id: "seed-disciples",
    ...ENGLISH,
    queryText: "disciples",
    tags: ["algolia-top-search", "bible-topic"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=134.",
  }),
  seedPrompt({
    id: "seed-abraham",
    ...ENGLISH,
    queryText: "abraham",
    tags: ["algolia-top-search", "bible-topic"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=6, nbHits=1.",
  }),
  seedPrompt({
    id: "seed-bible-stories",
    ...ENGLISH,
    queryText: "bible stories",
    tags: ["algolia-top-search", "catalog", "bible-topic", "synonym"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=9.",
  }),
  seedPrompt({
    id: "seed-zulu",
    ...ENGLISH,
    queryText: "zulu",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=313.",
  }),
  seedPrompt({
    id: "seed-english",
    ...ENGLISH,
    queryText: "english",
    tags: ["algolia-top-search", "multilingual", "language-name", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=1053.",
  }),
  seedPrompt({
    id: "seed-joseph",
    ...ENGLISH,
    queryText: "joseph",
    tags: ["algolia-top-search", "bible-topic", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=11.",
  }),
  seedPrompt({
    id: "seed-indonesia",
    ...ENGLISH,
    queryText: "indonesia",
    tags: ["algolia-top-search", "multilingual", "language-name"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=417.",
  }),
  seedPrompt({
    id: "seed-paul",
    ...ENGLISH,
    queryText: "paul",
    tags: ["algolia-top-search", "bible-topic", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=213.",
  }),
  seedPrompt({
    id: "seed-john",
    ...ENGLISH,
    queryText: "john",
    tags: ["algolia-top-search", "bible-topic", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=173.",
  }),
  seedPrompt({
    id: "seed-legion",
    ...ENGLISH,
    queryText: "legion",
    tags: ["algolia-top-search", "bible-topic", "scene-like"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=6.",
  }),
  seedPrompt({
    id: "seed-where-you-belong",
    ...ENGLISH,
    queryText: "where you belong",
    tags: ["algolia-top-search", "product-title", "felt-need"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=2.",
  }),
  seedPrompt({
    id: "seed-christmas",
    ...ENGLISH,
    queryText: "christmas",
    tags: ["algolia-top-search", "seasonal", "bible-topic"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=86.",
  }),
  seedPrompt({
    id: "seed-coach",
    ...ENGLISH,
    queryText: "coach",
    tags: ["algolia-top-search", "sports-outreach", "confusing"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=5, nbHits=156.",
  }),
  seedPrompt({
    id: "seed-spanish-jesus",
    locale: "es",
    languageSlug: "spanish-castilian",
    queryText: "Jesus en espanol",
    tags: ["locale", "core-title", "product-title", "multilingual"],
  }),
  seedPrompt({
    id: "seed-spanish-castilian-children-bible-films",
    locale: "es",
    languageSlug: "spanish-castilian",
    websiteLocale: "en",
    queryText: "películas bíblicas para niños",
    tags: [
      "locale",
      "semantic-language",
      "children",
      "mismatch",
      "multilingual",
    ],
    operatorNotes:
      "Exercises Spanish semantic search language selection from an English website/watch route.",
  }),
  seedPrompt({
    id: "seed-hindi-who-is-jesus",
    locale: "hi",
    languageSlug: "hindi",
    queryText: "यीशु कौन हैं?",
    tags: [
      "locale",
      "semantic-language",
      "question",
      "new-believer",
      "multilingual",
    ],
    operatorNotes:
      "Exercises non-Latin typed-query language detection and Hindi semantic search language selection.",
  }),
  seedPrompt({
    id: "seed-french-route-english-who-is-jesus",
    locale: "en",
    languageSlug: "english",
    websiteLocale: "fr",
    queryText: "Who is Jesus?",
    tags: ["question", "semantic-language", "mismatch", "multilingual"],
    operatorNotes:
      "Exercises English semantic search language selection from a French website/watch route.",
  }),
  seedPrompt({
    id: "seed-french-hope-youth",
    locale: "fr",
    languageSlug: "french",
    queryText: "videos d'espoir pour les jeunes",
    tags: ["locale", "audience", "youth", "felt-need", "multilingual"],
  }),
  seedPrompt({
    id: "seed-portuguese-jesus",
    locale: "pt",
    languageSlug: "portuguese-brazil",
    queryText: "Jesus em português",
    tags: ["locale", "core-title", "product-title", "multilingual"],
  }),
  seedPrompt({
    id: "seed-german-who-is-jesus",
    locale: "de",
    languageSlug: "german-standard",
    queryText: "Wer ist Jesus?",
    tags: ["locale", "question", "new-believer", "multilingual"],
  }),
  seedPrompt({
    id: "seed-russian-who-is-jesus",
    locale: "ru",
    languageSlug: "russian",
    queryText: "Кто такой Иисус?",
    tags: ["locale", "question", "new-believer", "multilingual"],
  }),
  seedPrompt({
    id: "seed-arabic-who-is-jesus",
    locale: "ar",
    languageSlug: "arabic-modern-standard",
    queryText: "من هو يسوع؟",
    tags: ["locale", "question", "new-believer", "multilingual"],
  }),
  seedPrompt({
    id: "seed-jesus-habla-del-espiritu-santo",
    locale: "es",
    languageSlug: "spanish-castilian",
    websiteLocale: "en",
    queryText: "jesus habla del espiritu santo",
    tags: ["algolia-top-search", "multilingual", "bible-topic", "mismatch"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=4, nbHits=4.",
  }),
  seedPrompt({
    id: "seed-lazaro",
    locale: "es",
    languageSlug: "spanish-castilian",
    websiteLocale: "en",
    queryText: "lazaro",
    tags: ["algolia-top-search", "multilingual", "bible-topic", "scene-like"],
    operatorNotes:
      "Algolia top query, 2026-05-22..2026-06-21: count=3, nbHits=6.",
  }),
  seedPrompt({
    id: "seed-thai-walking-on-water",
    locale: "th",
    languageSlug: "thai",
    websiteLocale: "en",
    queryText: "เดินบนทะเล",
    tags: ["algolia-no-result", "multilingual", "scene-like", "mismatch"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=1.",
  }),
  seedPrompt({
    id: "seed-chinese-vegetable-animation",
    locale: "zh",
    languageSlug: "mandarin-china",
    websiteLocale: "en",
    queryText: "蔬菜总动员",
    tags: [
      "algolia-no-result",
      "multilingual",
      "children",
      "confusing",
      "mismatch",
    ],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=4.",
  }),
  seedPrompt({
    id: "seed-finding-hope-heavy",
    ...ENGLISH,
    queryText: "finding hope when life feels heavy",
    tags: ["algolia-no-result", "felt-need", "synonym"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=3.",
  }),
  seedPrompt({
    id: "seed-anxiety-and-fear",
    ...ENGLISH,
    queryText: "anxiety and fear",
    tags: ["felt-need", "synonym"],
  }),
  seedPrompt({
    id: "seed-forgiveness-after-failure",
    ...ENGLISH,
    queryText: "forgiveness after failure",
    tags: ["felt-need", "bible-topic", "synonym"],
  }),
  seedPrompt({
    id: "seed-lonely-and-rejected",
    ...ENGLISH,
    queryText: "lonely and rejected",
    tags: ["felt-need", "synonym"],
  }),
  seedPrompt({
    id: "seed-grieving-a-loved-one",
    ...ENGLISH,
    queryText: "grieving a loved one",
    tags: ["felt-need", "synonym"],
  }),
  seedPrompt({
    id: "seed-purpose-in-life",
    ...ENGLISH,
    queryText: "purpose in life",
    tags: ["felt-need", "new-believer"],
  }),
  seedPrompt({
    id: "seed-how-to-pray-numb",
    ...ENGLISH,
    queryText: "how to pray when I feel numb",
    tags: ["felt-need", "question", "prayer"],
  }),
  seedPrompt({
    id: "seed-shame-and-guilt",
    ...ENGLISH,
    queryText: "shame and guilt",
    tags: ["felt-need", "synonym"],
  }),
  seedPrompt({
    id: "seed-prodigal-son",
    ...ENGLISH,
    queryText: "prodigal son",
    tags: ["bible-topic", "scene-like"],
  }),
  seedPrompt({
    id: "seed-woman-at-the-well",
    ...ENGLISH,
    queryText: "woman at the well",
    tags: ["bible-topic", "scene-like"],
  }),
  seedPrompt({
    id: "seed-sermon-on-the-mount",
    ...ENGLISH,
    queryText: "sermon on the mount",
    tags: ["bible-topic", "scene-like"],
  }),
  seedPrompt({
    id: "seed-water-into-wine",
    ...ENGLISH,
    queryText: "water into wine",
    tags: ["bible-topic", "scene-like"],
  }),
  seedPrompt({
    id: "seed-raising-lazarus",
    ...ENGLISH,
    queryText: "raising lazarus",
    tags: ["bible-topic", "scene-like"],
  }),
  seedPrompt({
    id: "seed-garden-of-gethsemane",
    ...ENGLISH,
    queryText: "garden of gethsemane",
    tags: ["bible-topic", "scene-like"],
  }),
  seedPrompt({
    id: "seed-feeding-five-thousand",
    ...ENGLISH,
    queryText: "feeding five thousand",
    tags: ["bible-topic", "scene-like"],
  }),
  seedPrompt({
    id: "seed-walking-wih-jesus",
    ...ENGLISH,
    queryText: "walking wih jesus",
    tags: ["algolia-no-result", "misspelling", "product-title"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=2.",
  }),
  seedPrompt({
    id: "seed-walking-wth-jesus",
    ...ENGLISH,
    queryText: "walking wth jesus",
    tags: ["algolia-no-result", "misspelling", "product-title"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=2.",
  }),
  seedPrompt({
    id: "seed-jrius-daughter",
    ...ENGLISH,
    queryText: "jrius daughter",
    tags: ["algolia-no-result", "misspelling", "bible-topic", "scene-like"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=2.",
  }),
  seedPrompt({
    id: "seed-jesus-feature-ilm",
    ...ENGLISH,
    queryText: "jesus feature ilm",
    tags: ["algolia-no-result", "misspelling", "product-title"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=2.",
  }),
  seedPrompt({
    id: "seed-reflection-of-hpe",
    ...ENGLISH,
    queryText: "reflection of hpe",
    tags: ["algolia-no-result", "misspelling", "product-title", "felt-need"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=1.",
  }),
  seedPrompt({
    id: "seed-matheuw",
    ...ENGLISH,
    queryText: "matheuw",
    tags: ["algolia-no-result", "misspelling", "bible-topic"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=1.",
  }),
  seedPrompt({
    id: "seed-abharam",
    ...ENGLISH,
    queryText: "abharam",
    tags: ["algolia-no-result", "misspelling", "bible-topic"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=1.",
  }),
  seedPrompt({
    id: "seed-ananias-at-saapphira",
    ...ENGLISH,
    queryText: "ananias at saapphira",
    tags: ["algolia-no-result", "misspelling", "bible-topic", "scene-like"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=1.",
  }),
  seedPrompt({
    id: "seed-jeus-our-loving-pusuer",
    ...ENGLISH,
    queryText: "jeus our loving pusuer",
    tags: ["algolia-no-result", "misspelling", "felt-need"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=1.",
  }),
  seedPrompt({
    id: "seed-initiatbirth-of-john",
    ...ENGLISH,
    queryText: "initiatbirth of john",
    tags: ["algolia-no-result", "misspelling", "bible-topic", "scene-like"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=2.",
  }),
  seedPrompt({
    id: "seed-brothers-living-together",
    ...ENGLISH,
    queryText: "brothers living together",
    tags: ["algolia-no-result", "confusing", "bible-topic"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=3.",
  }),
  seedPrompt({
    id: "seed-world-cup-2026-outreach",
    ...ENGLISH,
    queryText: "world cup 2026 outreach",
    tags: ["algolia-no-result", "confusing", "sports-outreach"],
    operatorNotes: "Algolia no-result query, 2026-05-22..2026-06-21: count=1.",
  }),
  seedPrompt({
    id: "seed-ai-easter-devotional-hope",
    ...ENGLISH,
    queryText:
      "Find videos for an Easter devotional about hope after disappointment",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "devotional", "seasonal", "felt-need"],
  }),
  seedPrompt({
    id: "seed-ai-pentecost-holy-spirit",
    ...ENGLISH,
    queryText:
      "Select videos for a Pentecost experience about the Holy Spirit helping ordinary believers",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "devotional", "bible-topic"],
  }),
  seedPrompt({
    id: "seed-ai-muslim-audience-son-of-god",
    ...ENGLISH,
    queryText:
      "Source videos for a Muslim audience exploring what Christians mean by Jesus as Son of God",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "audience", "bible-topic"],
  }),
  seedPrompt({
    id: "seed-ai-teen-anxiety-identity",
    ...ENGLISH,
    queryText:
      "Find short videos for teenagers struggling with anxiety and identity",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "audience", "felt-need", "teens"],
  }),
  seedPrompt({
    id: "seed-ai-related-prayer-section",
    ...ENGLISH,
    queryText:
      "Recommend related videos for a page section about learning to pray when life is hard",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "related-content", "prayer"],
  }),
  seedPrompt({
    id: "seed-ai-children-forgiveness-series",
    ...ENGLISH,
    queryText:
      "Pick child-friendly videos for a short series about forgiveness and making things right",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "children", "felt-need"],
  }),
  seedPrompt({
    id: "seed-ai-new-believer-follow-jesus",
    ...ENGLISH,
    queryText:
      "Choose videos for a new believer experience about starting to follow Jesus",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "new-believer", "discipleship"],
  }),
  seedPrompt({
    id: "seed-ai-advent-mary-joseph",
    ...ENGLISH,
    queryText:
      "Find videos for an Advent devotional about Mary Joseph and trusting God",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "seasonal", "devotional"],
  }),
  seedPrompt({
    id: "seed-ai-workplace-integrity",
    ...ENGLISH,
    queryText:
      "Select videos for adults wrestling with integrity at work and following Jesus",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "audience", "felt-need"],
  }),
  seedPrompt({
    id: "seed-ai-grief-comfort",
    ...ENGLISH,
    queryText:
      "Find videos for a devotional that comforts someone grieving a loved one",
    callerTracks: ["ai-experience-generation"],
    tags: ["ai-experience-generation", "devotional", "felt-need"],
  }),
  seedPrompt({
    id: "seed-semantic-lost-son-welcomed-home",
    ...ENGLISH,
    queryText:
      "a story where a lost son is welcomed home by his father after wasting everything",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "scene-like", "paraphrase"],
  }),
  seedPrompt({
    id: "seed-semantic-blind-man-cries-out",
    ...ENGLISH,
    queryText: "a blind man keeps calling out to Jesus and receives his sight",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "scene-like", "paraphrase"],
  }),
  seedPrompt({
    id: "seed-semantic-wedding-water-wine",
    ...ENGLISH,
    queryText:
      "at a wedding the celebration runs out of wine and Jesus provides more",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "scene-like", "paraphrase"],
  }),
  seedPrompt({
    id: "seed-semantic-forgives-enemies-cross",
    ...ENGLISH,
    queryText:
      "Jesus asks forgiveness for the people hurting him while he is being killed",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "scene-like", "paraphrase"],
  }),
  seedPrompt({
    id: "seed-semantic-storm-becomes-calm",
    ...ENGLISH,
    queryText:
      "followers panic in a storm and Jesus makes the wind and waves quiet",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "scene-like", "paraphrase"],
  }),
  seedPrompt({
    id: "seed-semantic-god-stays-near-in-shame",
    ...ENGLISH,
    queryText:
      "someone feels ashamed and rejected but discovers God still comes close",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "felt-need", "paraphrase"],
  }),
  seedPrompt({
    id: "seed-semantic-kingdom-everyday-stories",
    ...ENGLISH,
    queryText:
      "short teachings that explain God's kingdom using ordinary everyday images",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "bible-topic", "paraphrase"],
  }),
  seedPrompt({
    id: "seed-semantic-friendship-with-outsider",
    ...ENGLISH,
    queryText:
      "Jesus shares kindness and truth with someone everyone else avoids",
    callerTracks: ["semantic-diagnostic"],
    tags: ["semantic-diagnostic", "scene-like", "paraphrase"],
  }),
] as const

export const SEARCH_EVAL_SEED_PROMPT_LOCALES = [
  ...new Set(SEARCH_EVAL_SEED_PROMPTS.map((prompt) => prompt.locale)),
] as const

export function seedPromptsForLocales(
  locales?: readonly string[],
  options: { callerTrack?: SearchEvalCallerTrack } = {},
) {
  const callerTrack = options.callerTrack ?? DEFAULT_SEARCH_EVAL_CALLER_TRACK
  const matchingTrack = SEARCH_EVAL_SEED_PROMPTS.filter((prompt) =>
    prompt.callerTracks.includes(callerTrack),
  )
  if (locales == null || locales.length === 0) {
    return [...matchingTrack]
  }
  const allowed = new Set(locales)
  return matchingTrack.filter((prompt) => allowed.has(prompt.locale))
}
