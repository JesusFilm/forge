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

function validateTranslation(sourceMessages, translations, minimumChangeRatio) {
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

Translate each supplied English UI message into the requested target language. The dotted key identifies the component and contextual purpose. Write natural, concise interface copy appropriate to the message's position, not a word-for-word gloss.

Requirements:
- Preserve every ICU variable name exactly, including variables inside plural/select messages.
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

function buildUserPrompt({ locale, inventoryEntry, messages, references }) {
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
        "Headings, buttons, aria labels, errors, metadata, and promotional copy should fit their named UI context.",
        "Existing non-English reference translations show preferred terminology; do not rewrite them.",
      ],
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
  locale,
  inventoryEntry,
  messages,
  references,
  model,
  maxAttempts,
  minimumChangeRatio,
  fetchImpl = globalThis.fetch,
  waitForRetry = wait,
}) {
  let previousError = ""
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const useResponsesApi =
      model.includes("-pro") || model.startsWith("gpt-5.6-")
    const userPrompt = `${buildUserPrompt({
      locale,
      inventoryEntry,
      messages,
      references,
    })}${
      previousError
        ? `\n\nThe previous response failed validation: ${previousError}. Return a corrected complete result.`
        : ""
    }`
    let response
    try {
      response = await fetchImpl(
        useResponsesApi
          ? "https://api.openai.com/v1/responses"
          : "https://api.openai.com/v1/chat/completions",
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
  isSourceEquivalent,
  messageContractError,
  PermanentApiError,
  requestTranslations,
  TranslationApiError,
}
