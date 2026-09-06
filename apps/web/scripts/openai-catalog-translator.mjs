const FALLBACK_LANGUAGE_NAMES = {
  bjt: "Balanta-Ganja",
  bsc: "Bassari (Oniyan)",
  caa: "Ch'orti'",
  cak: "Kaqchikel",
  ixl: "Ixil",
  knf: "Mankanya",
  lbe: "Lak",
  mdh: "Maguindanao",
  mfv: "Mandjak",
  quv: "Sacapulteco",
  sav: "Saafi-Saafi",
  snf: "Noon",
  tnr: "Bedik",
  tsg: "Tausug",
  usp: "Uspanteco",
  xin: "Xinca",
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

const UI_SURFACE_CONTEXTS = {
  AccountControl: "the Watch account menu",
  BetaTesterModal: "the Watch beta-feedback dialog",
  BibleQuotes: "the Bible quotation section on a Watch page",
  CollectionDownloadModal: "the collection download dialog",
  DownloadButton: "the download control on a Watch page",
  DownloadModal: "the video download dialog",
  ExperienceError: "a full-page Watch error state",
  ExperienceSkeleton: "the Watch page loading state",
  Feedback: "the Watch feedback form",
  FloatingSearch: "the persistent Watch search control",
  HeroPlayer: "the main Watch video player",
  HeroPlayerControls: "the main Watch video player controls",
  LanguageCombobox: "a searchable language selector",
  LanguageInventory: "a page listing videos available in one language",
  LanguagePickerModal: "the Watch language and subtitle picker",
  RecommendationConsent:
    "the Watch cookie consent banner and privacy settings dialog",
  SearchOverlay: "the full-screen Watch search experience",
  SearchResultCard: "a card in Watch search results",
  SeriesPage: "a Watch series and episodes page",
  ShareModal: "the Watch sharing dialog",
  SiblingCarousel: "the related episodes carousel on a Watch page",
  SubtitleTranscript: "the subtitle transcript panel",
  VideoLabels: "labels attached to Watch video cards",
  VideoRecommendations: "the recommended videos section",
  VideosPage: "a Watch videos listing page",
  WatchFooter: "the Watch site footer",
  WatchHistory: "the user's Watch history page",
  WatchHome: "the Watch homepage",
  WatchHomeCategories:
    "the browse-by-category rail on the Watch homepage, whose cards open a collection of videos",
  WatchHomeMuxInserts: "promotional video inserts on the Watch homepage",
  WatchHomePromo: "a promotional section on the Watch homepage",
  WatchHomeSections: "content sections on the Watch homepage",
  WatchLanguageIndex: "the all-languages index for Watch",
  WatchModal: "a shared Watch dialog",
  WatchNotFound: "the localized Watch 404 page",
  WatchQuestionPanel: "an interactive study-question panel",
  WatchStudyQuestions: "the study questions section on a Watch page",
  WatchUnavailableLanguage:
    "the recovery page shown when content exists but the requested language version does not",
}

// Some copy roles and runtime compositions cannot be inferred from catalog
// keys alone. Keep verified component-use overrides close to the prompt
// builder so a translation batch receives the real presentation constraint.
const MESSAGE_CONTEXT_OVERRIDES = {
  "AccountControl.accountMenu": {
    role: "account-menu accessibility label",
    visibility: "assistive technology only",
  },
  "BibleQuotes.nextQuote": {
    role: "carousel navigation accessibility label",
    visibility: "assistive technology only",
  },
  "BibleQuotes.previousQuote": {
    role: "carousel navigation accessibility label",
    visibility: "assistive technology only",
  },
  "DownloadModal.posterAlt": {
    role: "image alternative text",
  },
  "ExperienceError.authFailed": {
    role: "authentication failure message",
    composition:
      "Rendered inside a failed-to-load sentence. It represents failed authentication with the content service, not a network connection failure.",
  },
  "FloatingSearch.library": {
    role: "site-header navigation button label",
    composition:
      "Labels the header control that opens the full catalogue of watchable VIDEOS for the visitor's language. `Library` here means a browsable collection of videos — a video library or video catalogue — NOT a building that lends books, an archive of documents, or a software/code library. Prefer the conventional target-language wording a streaming or video-on-demand product would use for its full video catalogue. Keep it short enough for a header button beside an icon.",
  },
  "LanguageCombobox.languages": {
    role: "language results list accessibility label",
    visibility: "assistive technology only",
  },
  "LanguagePickerModal.translateWithAi": {
    role: "action label",
  },
  "LanguagePickerModal.noSubtitles": {
    role: "subtitle unavailable-state message",
    composition:
      "May render as `No subtitles ({languageName})`; write the base phrase so the appended native language name reads naturally.",
  },
  "LanguagePickerModal.subtitlesHeading": {
    role: "section heading and accessibility-label prefix",
    composition:
      "Shown as a visible heading and reused before an on/off state in an accessibility label.",
  },
  "LanguagePickerModal.toggleOff": {
    role: "toggle state label",
    composition: "May follow the subtitles heading in an accessibility label.",
  },
  "LanguagePickerModal.toggleOn": {
    role: "toggle state label",
    composition:
      "May follow the subtitles heading or precede a parenthesized subtitle language code in an accessibility label.",
  },
  "CollectionDownloadModal.signInTitle": {
    role: "download authentication heading",
    composition:
      "The user must authenticate before the collection download can start. The following action sends them to sign in.",
  },
  "CollectionDownloadModal.signIn": {
    role: "download authentication action label",
    composition:
      "Selecting it sends the user to sign in, then returns them to the dialog so they can start the download.",
  },
  "HeroPlayerControls.changeAudioLanguage": {
    role: "player-control accessibility action label",
    composition:
      "May render as `Change audio language: {languageCode}` with a runtime language code appended by the component.",
  },
  "HeroPlayerControls.seek": {
    role: "timeline slider accessibility label",
    visibility: "assistive technology only",
  },
  "HeroPlayerControls.seekValue": {
    role: "timeline slider accessibility value",
    visibility: "assistive technology only",
  },
  "HeroPlayerControls.volume": {
    role: "volume slider accessibility label",
    visibility: "assistive technology only",
  },
  "HeroPlayerControls.volumeValue": {
    role: "volume slider accessibility value",
    visibility: "assistive technology only",
  },
  "SearchResultCard.thumbnailAlt": {
    role: "image alternative text",
  },
  "ShareModal.posterAlt": {
    role: "image alternative text",
  },
  "ShareModal.shareOnFacebookUnavailable": {
    role: "disabled action label",
  },
  "ShareModal.shareOnXUnavailable": {
    role: "disabled action label",
  },
  "SiblingCarousel.thumbnailAlt": {
    role: "image alternative text",
  },
  "SubtitleTranscript.aiSuffix": {
    role: "AI-generated subtitle marker",
    composition:
      "Appended directly after a runtime subtitle language name; include only the separator and concise marker needed by the complete label.",
  },
  "WatchHome.mutePreview": {
    role: "video-preview accessibility action label",
    visibility: "assistive technology only",
  },
  "WatchHomePromo.buildingNext": {
    role: "heading introducing the following feature cards",
    composition:
      "A standalone visual heading immediately above cards describing future products or capabilities; write a complete Chinese heading, not an introductory clause.",
  },
  "WatchHomeSections.scriptureAsWrittenTitle": {
    role: "collection title",
    composition:
      "Describes Scripture spoken verbatim as it is written. It does not refer to Hebrew, Greek, or another original-language source.",
  },
  "WatchHome.unmutePreview": {
    role: "video-preview accessibility action label",
    visibility: "assistive technology only",
  },
  "WatchLanguageIndex.showLess": {
    role: "action label",
  },
  "WatchLanguageIndex.showMore": {
    role: "action label",
  },
  "WatchNotFound.actionsLabel": {
    role: "404-page actions accessibility label",
    visibility: "assistive technology only",
  },
  "WatchNotFound.screenReaderPrefix": {
    role: "screen-reader prefix before the 404 heading",
    visibility: "assistive technology only",
  },
  "WatchUnavailableLanguage.actionsLabel": {
    role: "recovery-page actions accessibility label",
    visibility: "assistive technology only",
  },
  "WatchUnavailableLanguage.audioVersionsTitle": {
    role: "section heading",
  },
  "WatchUnavailableLanguage.languageVersionLabel": {
    role: "audio-language selector accessibility label",
    visibility: "assistive technology only",
  },
}

function messageRole(key) {
  const leaf = key.split(".").at(-1) ?? key
  if (leaf === "metadataTitle") return "browser and search metadata title"
  if (leaf === "metadataDescription") {
    return "browser and search metadata description"
  }
  if (/placeholder$/iu.test(leaf)) return "input placeholder"
  if (/^(?:aria|.*Aria)|(?:.*NavLabel)$/u.test(leaf)) {
    return "accessibility label"
  }
  if (/title$/iu.test(leaf)) {
    return key === "WatchUnavailableLanguage.title" ? "page heading" : "heading"
  }
  if (/(?:description|body|hint|help|supportingText|fallback)$/iu.test(leaf)) {
    return "supporting explanation"
  }
  if (
    /^(?:error|failed)|(?:error|failed|unavailable|noResults|notConfigured)$/iu.test(
      leaf,
    )
  ) {
    return "error or unavailable-state message"
  }
  if (
    /^(?:loading|downloading|canceled|signedIn|playingNow|searchingInLanguage)/u.test(
      leaf,
    )
  ) {
    return "status message"
  }
  if (/(?:label|eyebrow|badge|format|tab|mode)$/iu.test(leaf)) {
    return "short interface label"
  }
  if (
    /^(?:accept|apply|back|browse|cancel|clear|close|continue|copy|delete|download|keep|load|open|play|retry|save|select|share|sign|start|submit|watch)/u.test(
      leaf,
    )
  ) {
    return "action label"
  }
  return "interface message"
}

function messageContexts(messages) {
  return Object.fromEntries(
    Object.entries(messages).map(([key, message]) => {
      const namespace = key.split(".", 1)[0]
      const hasRuntimeComposition =
        /\{[A-Za-z][A-Za-z0-9_]*(?:\s*[,}])/u.test(message) ||
        /<\/?[A-Za-z][A-Za-z0-9_]*>/u.test(message)
      return [
        key,
        {
          surface:
            UI_SURFACE_CONTEXTS[namespace] ??
            `the ${namespace} area of the Watch experience`,
          role: messageRole(key),
          ...(hasRuntimeComposition
            ? {
                composition:
                  "Rendered with runtime values or rich-text parts; judge and write the complete rendered message, not isolated fragments.",
              }
            : {}),
          ...(MESSAGE_CONTEXT_OVERRIDES[key] ?? {}),
        },
      ]
    }),
  )
}

function surroundingSourceMessages(messages, sourceMessages = messages) {
  const requestedKeys = new Set(Object.keys(messages))
  const requestedNamespaces = new Set(
    [...requestedKeys].map((key) => key.split(".", 1)[0]),
  )

  return Object.fromEntries(
    Object.entries(sourceMessages).filter(([key]) => {
      const namespace = key.split(".", 1)[0]
      return requestedNamespaces.has(namespace) && !requestedKeys.has(key)
    }),
  )
}

const UNIVERSAL_TARGET_LANGUAGE_WRITING_INSTRUCTIONS = [
  "Write as though the interface were originally written by a native product writer in the target language, not translated from English.",
  "Use established Christian terminology familiar to the target-language Christian community for faith content, and familiar target-language product or video-interface conventions for generic interactions.",
  "Use reputable target-language Christian and video-product conventions as a reference for terminology and tone. When reference materials are supplied in the context, derive the convention from them but never copy their wording or infer product facts they do not establish.",
  "When English uses a biblical metaphor or idiom, identify its intended meaning and UI purpose before translating. Use established scripture wording only when the allusion remains clear in that surface; otherwise express the meaning naturally instead of translating the imagery word for word. Preserve the theological meaning without inventing an interpretation.",
  "When the provided context contains equivalent target-catalog copy for the same user action or state, reuse that equivalent target-catalog copy unless the UI behavior differs materially.",
  "Do not add product claims, promises, instructions, or theological meaning that are absent from the English source and UI context.",
]

function targetLanguageWritingInstructions(locale) {
  if (new Intl.Locale(locale).language !== "zh") {
    return UNIVERSAL_TARGET_LANGUAGE_WRITING_INSTRUCTIONS
  }

  return [
    ...UNIVERSAL_TARGET_LANGUAGE_WRITING_INSTRUCTIONS,
    "Express the user-facing intent directly. Do not preserve English sentence structure, repeated subjects, passive voice, noun-heavy phrasing, or filler when concise Chinese is clearer.",
    "Use natural Chinese interface rhythm and punctuation. Avoid unnecessary spaces around Chinese text, ICU placeholders, and rich-text tags.",
    "Keep actions short and verb-led, states immediately understandable, and supporting explanations conversational but respectful.",
    "For English action labels shaped like 'verb to verb', determine whether the second action is a later outcome, a condition, or part of the same click. Use a natural Chinese sequence or condition such as X后Y or X并Y instead of mechanically rendering 'to' as 以, and never imply that a control performs a later action it only unlocks.",
    "For accessibility-only text, write a complete, unambiguous phrase that sounds natural when spoken by a screen reader; visual brevity is secondary.",
    "For messages assembled from placeholders or rich-text tags, mentally render representative values and make the final Chinese sentence natural as a whole.",
    "Preserve the exact failure category expressed in the English source and message context (for example, authentication versus connection, loading, or configuration); never replace it with a more familiar error category.",
    "Do not use 原文 or equivalent original-language wording unless the source or message context explicitly refers to an original-language source. In Scripture copy, distinguish a verbatim spoken reading from Hebrew/Greek original-language content.",
    "Make standalone visual headings self-contained: they must complete the thought on their own, rather than leave a translated English-style introductory clause above the next element.",
    "Follow the requested Simplified or Traditional script and its established terminology; do not mechanically convert characters when wording conventions differ.",
    "For Traditional Chinese, use established Traditional Chinese vocabulary as well as Traditional characters; avoid Mainland Chinese word choices when a natural Traditional equivalent is available.",
  ]
}

class TranslationApiError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = "TranslationApiError"
    this.code = code
  }
}

class PermanentApiError extends TranslationApiError {
  constructor(message) {
    super("OPENAI_PERMANENT_ERROR", message)
    this.name = "PermanentApiError"
  }
}

function sameSet(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  )
}

function messageVariables(message) {
  const variables = new Set()
  for (const match of message.matchAll(
    /\{([A-Za-z][A-Za-z0-9_]*)\s*(?:,|\})/g,
  )) {
    variables.add(match[1])
  }
  return variables
}

function richTextTags(message) {
  return new Set(
    [...message.matchAll(/<\/?([A-Za-z][A-Za-z0-9_]*)>/g)].map(
      (match) => match[1],
    ),
  )
}

function hasBalancedBraces(message) {
  let depth = 0
  for (const character of message) {
    if (character === "{") depth += 1
    if (character === "}") depth -= 1
    if (depth < 0) return false
  }
  return depth === 0
}

function messageContractError(key, source, value) {
  if (typeof value !== "string") return `Missing translation: ${key}`
  if (source.length === 0 && value.length === 0) return null
  if (value.trim().length === 0) return `Empty translation: ${key}`
  if (value.includes("```")) return `Markdown fence in translation: ${key}`
  if (!hasBalancedBraces(value)) return `Unbalanced ICU braces: ${key}`
  if (!sameSet(messageVariables(source), messageVariables(value))) {
    return `ICU variable mismatch: ${key}`
  }
  if (!sameSet(richTextTags(source), richTextTags(value))) {
    return `Rich-text tag mismatch: ${key}`
  }
  if (
    source.includes("#") &&
    source.includes("plural") &&
    !value.includes("#")
  ) {
    return `Plural substitution marker missing: ${key}`
  }
  if (
    key === "SearchOverlay.searchingInLanguage" &&
    /(?:\.{3}|…)[\s\p{P}]*$/u.test(value)
  ) {
    return `Completed-results status must not look like loading copy: ${key}`
  }
  return null
}

function sourceComparable(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\p{White_Space}\p{Cf}]+/gu, "")
}

function isSourceEquivalent(source, value) {
  return sourceComparable(source) === sourceComparable(value)
}

const SCRIPT_PROPERTY_BY_SUBTAG = {
  Arab: "Arabic",
  Cyrl: "Cyrillic",
  Deva: "Devanagari",
  Latn: "Latin",
  Mong: "Mongolian",
}

function explicitScriptContractError(locale, translations) {
  const explicitScript = new Intl.Locale(locale).script
  const scriptProperty = SCRIPT_PROPERTY_BY_SUBTAG[explicitScript]
  if (!scriptProperty) return null

  const expectedScript = new RegExp(`\\p{Script=${scriptProperty}}`, "gu")
  for (const [key, value] of Object.entries(translations)) {
    const prose = value.replace(/\{[^{}]+\}/gu, "")
    const letters = prose.match(/\p{L}/gu) ?? []
    if (letters.length === 0) continue
    const expectedLetters = prose.match(expectedScript)?.length ?? 0
    if (expectedLetters / letters.length < 0.5) {
      return `Explicit ${explicitScript} script mismatch: ${key}`
    }
  }
  return null
}

function validateTranslation(
  sourceMessages,
  translations,
  minimumChangeRatio,
  locale,
) {
  if (!Array.isArray(translations)) {
    throw new TranslationApiError(
      "INVALID_TRANSLATION_RESPONSE",
      "Response translations must be an array",
    )
  }

  const expectedKeys = Object.keys(sourceMessages)
  const translated = new Map()
  for (const entry of translations) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.key !== "string" ||
      typeof entry.value !== "string"
    ) {
      throw new TranslationApiError(
        "INVALID_TRANSLATION_ENTRY",
        "Every translation must contain string key and value",
      )
    }
    if (translated.has(entry.key)) {
      throw new TranslationApiError(
        "DUPLICATE_TRANSLATION_KEY",
        `Duplicate translated key: ${entry.key}`,
      )
    }
    translated.set(entry.key, entry.value)
  }

  const missing = expectedKeys.filter((key) => !translated.has(key))
  const unexpected = [...translated.keys()].filter(
    (key) => !Object.hasOwn(sourceMessages, key),
  )
  if (missing.length > 0 || unexpected.length > 0) {
    throw new TranslationApiError(
      "TRANSLATION_KEY_MISMATCH",
      `Translation key mismatch; missing=${missing.slice(0, 8).join(",")}; unexpected=${unexpected.slice(0, 8).join(",")}`,
    )
  }

  for (const [key, source] of Object.entries(sourceMessages)) {
    const value = translated.get(key)
    const error = messageContractError(key, source, value)
    if (error) {
      throw new TranslationApiError("TRANSLATION_CONTRACT_MISMATCH", error)
    }
  }

  const scriptError = explicitScriptContractError(
    locale,
    Object.fromEntries(translated),
  )
  if (scriptError) {
    throw new TranslationApiError("TRANSLATION_SCRIPT_MISMATCH", scriptError)
  }

  const changedMessages = Object.entries(sourceMessages).filter(
    ([key, source]) => !isSourceEquivalent(source, translated.get(key)),
  ).length
  if (
    minimumChangeRatio > 0 &&
    changedMessages / Object.keys(sourceMessages).length < minimumChangeRatio
  ) {
    throw new TranslationApiError(
      "SOURCE_COPY_LIMIT_EXCEEDED",
      `Translation changed only ${changedMessages}/${Object.keys(sourceMessages).length} messages; at least ${Math.ceil(minimumChangeRatio * Object.keys(sourceMessages).length)} must change to keep the whole catalog below the English-copy limit`,
    )
  }

  return Object.fromEntries(translated)
}

function localeDisplayName(locale) {
  if (FALLBACK_LANGUAGE_NAMES[locale]) return FALLBACK_LANGUAGE_NAMES[locale]
  try {
    const displayName = new Intl.DisplayNames(["en"], {
      type: "language",
    }).of(locale)
    if (displayName && displayName !== locale) return displayName
  } catch {
    // The explicit BCP-47 tag and country context are still supplied below.
  }
  return locale
}

function buildSystemPrompt() {
  return `You are a senior software localization translator for Jesus Film Project, a Christian video-streaming and discipleship website.

Translate each supplied English UI message into the requested target language. Treat the English value as the meaning to preserve, not a sentence template to imitate. Use each dotted key's messageContexts entry to understand the actual screen and copy role before writing the translation.

Requirements:
- Preserve every ICU variable name exactly, including variables inside plural/select messages.
- Write the text a native product writer would choose for that screen and user intent. Prefer the target language's normal information order, idiom, and level of brevity over structural similarity to English.
- Preserve XML-like rich-text tag names exactly, but move tagged phrases where target-language grammar requires it.
- Adapt ICU plural categories to the target language when needed while keeping the original variable.
- Runtime {language} values are native language names. Prefer case-neutral punctuation such as a colon when grammatical inflection would otherwise be required.
- Keep product and series names such as Jesus Film Project, BibleProject, NUA, and NUA: Origins unchanged unless a standard local form is supplied in the source context.
- Keep URLs, keyboard tokens, abbreviations, and technical identifiers unchanged.
- Use established Christian terminology in the target language and a respectful, accessible tone.
- For low-resource languages, produce the best natural target-language copy you can; do not leave full English sentences merely because a borrowed technical noun is common.
- Honor an explicit BCP-47 script subtag. When the locale does not specify a script, follow the writing system established by existing reference translations, using the locale's default script only when references do not establish one. Never substitute a bridge language or mix unrelated writing systems into a message.
- Every supplied message is intentionally translatable and currently requires work. Return a value different from its English source for every entry; explicit locale-neutral exceptions are excluded before this request.
- Return one entry for every requested key and no extra keys.`
}

function buildUserPrompt({
  locale,
  inventoryEntry,
  messages,
  references,
  sourceMessages = messages,
}) {
  const parsedLocale = new Intl.Locale(locale)
  const explicitScript = parsedLocale.script
  const defaultScript = parsedLocale.maximize().script ?? "not specified"
  const countries = (inventoryEntry?.countries ?? [])
    .map((country) => country.name)
    .join(", ")
  return JSON.stringify(
    {
      targetLocale: locale,
      targetLanguage: localeDisplayName(locale),
      scriptAndRegion: locale,
      explicitScript: explicitScript ?? "not specified",
      defaultScript,
      scriptInstructions: explicitScript
        ? `Use the explicitly requested ${explicitScript} script.`
        : `Follow the writing system established by the reference translations; use the locale default ${defaultScript} only when references do not establish one.`,
      officialLanguageCountries: countries || "not specified",
      contextualInstructions: [
        "Translate only the message values; return dotted keys unchanged.",
        "Read messageContexts for every key before translating. The surface explains where the text appears; the role explains what job it performs. Resolve wording from that user situation rather than from the English sentence shape alone.",
        "When a messageContext includes visibility or composition, honor it explicitly: accessibility-only copy must work when spoken aloud, and composed copy must read naturally after runtime values and rich-text parts are inserted.",
        "When surroundingSourceMessages is non-empty, read those neighboring English messages from the same UI namespace before translating. They provide screen context only and must not be returned or translated unless also present in messagesToTranslate.",
        "Headings, buttons, aria labels, errors, metadata, and promotional copy should fit their named UI context.",
        "Prioritize natural native-language interface writing over similarity to English. Translate the intended action or state, not the English syntax. Reorder concepts, change parts of speech, split clauses, and use idiomatic target-language patterns whenever that reads more naturally.",
        "Do not preserve English punctuation, capitalization, quotation style, or word order unless those conventions are also natural in the target language.",
        "SearchOverlay.searchSuggestions is a heading above proposed search phrases. SearchOverlay.directMatches is a heading above matching videos, scenes, and collections.",
        "SearchOverlay.searchSuggestionWithLanguage is a clickable action that immediately searches for {suggestion} in {language}; use natural action wording, not disconnected field labels.",
        "SearchOverlay.searchInLanguage names the language scope before a query is submitted. SearchOverlay.searchingInLanguage is a static scope label shown after results have loaded. Translate it with the meaning 'Results are scoped to {language}'. It must not say that a search is active, loading, or in progress, and must not end with an ellipsis.",
        "The {language} value in these SearchOverlay messages is an interactive UI chip. Write the surrounding sentence according to target-language grammar. Case particles, postpositions, and other grammatical material may immediately precede or follow the placeholder and will render outside the clickable chip. Never rename or alter the placeholder token itself.",
        "When the language name itself must inflect internally, use a construction natural to the target language that accepts a citation-form language name, unless the supplied reference already demonstrates a runtime contextual form. Do not fall back to disconnected English-style labels merely to avoid target-language grammar.",
        "Existing non-English reference translations show preferred terminology; do not rewrite them.",
      ],
      targetLanguageWritingInstructions:
        targetLanguageWritingInstructions(locale),
      messageContexts: messageContexts(messages),
      surroundingSourceMessages: surroundingSourceMessages(
        messages,
        sourceMessages,
      ),
      existingReferenceTranslations: references,
      messagesToTranslate: messages,
    },
    null,
    2,
  )
}

const RESPONSE_SCHEMA = {
  name: "watch_ui_catalog_translation",
  strict: true,
  schema: {
    type: "object",
    properties: {
      translations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            value: { type: "string" },
          },
          required: ["key", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["translations"],
    additionalProperties: false,
  },
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryAfterMilliseconds(value) {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

function retryDelay(attempt, retryAfterHeader) {
  return (
    Math.max(retryAfterMilliseconds(retryAfterHeader), attempt * 4000) +
    Math.floor(Math.random() * 500)
  )
}

async function requestTranslations({
  apiKey,
  baseUrl = DEFAULT_OPENAI_BASE_URL,
  locale,
  inventoryEntry,
  messages,
  references,
  sourceMessages,
  model,
  maxAttempts,
  minimumChangeRatio,
  fetchImpl = globalThis.fetch,
  waitForRetry = wait,
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  let previousError = ""
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const useResponsesApi =
      model.includes("-pro") || model.startsWith("gpt-5.6-")
    const userPrompt = `${buildUserPrompt({
      locale,
      inventoryEntry,
      messages,
      references,
      sourceMessages,
    })}${
      previousError
        ? `\n\nThe previous response failed validation: ${previousError}. Return a corrected complete result.`
        : ""
    }`
    let response
    try {
      response = await fetchImpl(
        useResponsesApi
          ? `${normalizedBaseUrl}/responses`
          : `${normalizedBaseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            useResponsesApi
              ? {
                  model,
                  instructions: buildSystemPrompt(),
                  input: userPrompt,
                  max_output_tokens: 40_000,
                  store: false,
                  text: {
                    format: { type: "json_schema", ...RESPONSE_SCHEMA },
                  },
                }
              : {
                  model,
                  messages: [
                    { role: "system", content: buildSystemPrompt() },
                    { role: "user", content: userPrompt },
                  ],
                  max_completion_tokens: 20_000,
                  response_format: {
                    type: "json_schema",
                    json_schema: RESPONSE_SCHEMA,
                  },
                },
          ),
          signal: AbortSignal.timeout(useResponsesApi ? 900_000 : 240_000),
        },
      )
    } catch (error) {
      previousError = `OpenAI request failed: ${
        error instanceof Error ? error.message : String(error)
      }`
      if (attempt < maxAttempts) {
        await waitForRetry(retryDelay(attempt))
        continue
      }
      throw new TranslationApiError("OPENAI_REQUEST_FAILED", previousError, {
        cause: error,
      })
    }

    if (!response.ok) {
      let detail = "response body unavailable"
      try {
        detail = (await response.text()).slice(0, 800)
      } catch (error) {
        detail = `response body unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
      previousError = `OpenAI HTTP ${response.status}: ${detail}`
      const retryable =
        [408, 409, 429].includes(response.status) || response.status >= 500
      if (!retryable) throw new PermanentApiError(previousError)
      if (attempt < maxAttempts) {
        await waitForRetry(
          retryDelay(attempt, response.headers.get("retry-after")),
        )
        continue
      }
      throw new TranslationApiError("OPENAI_RETRIES_EXHAUSTED", previousError)
    }

    try {
      const payload = await response.json()
      const outputContent = useResponsesApi
        ? (payload.output ?? []).flatMap((item) => item.content ?? [])
        : []
      const refusal = useResponsesApi
        ? outputContent.find((item) => item.type === "refusal")?.refusal
        : payload.choices?.[0]?.message?.refusal
      if (refusal) {
        throw new TranslationApiError(
          "MODEL_REFUSAL",
          `Model refused: ${refusal}`,
        )
      }

      const content = useResponsesApi
        ? (payload.output_text ??
          outputContent.find((item) => item.type === "output_text")?.text)
        : payload.choices?.[0]?.message?.content
      if (typeof content !== "string") {
        throw new TranslationApiError(
          "MISSING_MODEL_CONTENT",
          "Model returned no JSON content",
        )
      }

      let parsed = JSON.parse(content)
      if (typeof parsed === "string") parsed = JSON.parse(parsed)
      return {
        translations: validateTranslation(
          messages,
          parsed.translations,
          minimumChangeRatio,
          locale,
        ),
        usage: useResponsesApi
          ? {
              prompt_tokens: payload.usage?.input_tokens ?? 0,
              completion_tokens: payload.usage?.output_tokens ?? 0,
              total_tokens: payload.usage?.total_tokens ?? 0,
            }
          : (payload.usage ?? {}),
      }
    } catch (error) {
      previousError = error instanceof Error ? error.message : String(error)
    }

    if (attempt < maxAttempts) await waitForRetry(retryDelay(attempt))
  }

  throw new TranslationApiError(
    "TRANSLATION_VALIDATION_FAILED",
    previousError || "Translation failed validation",
  )
}

export {
  DEFAULT_OPENAI_BASE_URL,
  buildUserPrompt,
  explicitScriptContractError,
  isSourceEquivalent,
  messageContractError,
  PermanentApiError,
  requestTranslations,
  TranslationApiError,
}
