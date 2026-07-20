import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = join(scriptDir, "..")
const repoDir = join(appDir, "../..")

const DEFAULT_MESSAGES_DIR = join(appDir, "messages")
const DEFAULT_INVENTORY_PATH = join(
  repoDir,
  "docs/i18n/watch-ui-official-language-inventory.json",
)
const DEFAULT_MANIFEST_PATH = join(
  repoDir,
  "docs/i18n/watch-ui-provisional-catalogs.json",
)
const DEFAULT_PROGRESS_PATH = "/tmp/forge-watch-ui-translation-progress.json"
const DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17"
const DEFAULT_CONCURRENCY = 4
const DEFAULT_MAX_ATTEMPTS = 4
const SOURCE_LOCALE = "en"
const MAXIMUM_SOURCE_COPY_RATIO = 0

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

function argValue(name, fallback, args = process.argv) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

function integerArg(name, fallback, args = process.argv) {
  const value = Number.parseInt(argValue(name, String(fallback), args), 10)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"))
}

const translationPolicy = readJson(
  join(scriptDir, "ui-translation-policy.json"),
)
const INTENTIONALLY_LOCALE_NEUTRAL = new Set(
  translationPolicy.intentionallyLocaleNeutral,
)

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function contentDigest(value) {
  return createHash("sha256").update(renderJson(value)).digest("hex")
}

function sourceDigestForFlatCatalog(sourceFlat) {
  return contentDigest({
    sourceFlat,
    translationPolicy: {
      humanReviewedLocales: sortedUnique(
        translationPolicy.humanReviewedLocales ?? [],
      ),
      intentionallyLocaleNeutral: [...INTENTIONALLY_LOCALE_NEUTRAL].sort(),
    },
  })
}

function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, renderJson(value))
  renameSync(temporaryPath, path)
}

function flattenCatalog(catalog) {
  const flattened = {}

  function visit(value, path) {
    if (typeof value === "string") {
      flattened[path.join(".")] = value
      return
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Invalid message value at ${path.join(".")}`)
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, [...path, key])
    }
  }

  visit(catalog, [])
  return flattened
}

function unflattenCatalog(flatCatalog) {
  const catalog = {}
  for (const [path, value] of Object.entries(flatCatalog)) {
    const parts = path.split(".")
    if (parts.length < 2) throw new Error(`Invalid message path: ${path}`)
    let cursor = catalog
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {}
      cursor = cursor[part]
    }
    cursor[parts.at(-1)] = value
  }
  return catalog
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
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

function catalogKeyDifferences(sourceMessages, catalogMessages) {
  return {
    missing: Object.keys(sourceMessages).filter(
      (key) => !Object.hasOwn(catalogMessages, key),
    ),
    unexpected: Object.keys(catalogMessages).filter(
      (key) => !Object.hasOwn(sourceMessages, key),
    ),
  }
}

function validateCatalogKeys(sourceMessages, catalogMessages) {
  const { missing, unexpected } = catalogKeyDifferences(
    sourceMessages,
    catalogMessages,
  )
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Catalog key mismatch; missing=${missing.slice(0, 8).join(",")}; unexpected=${unexpected.slice(0, 8).join(",")}`,
    )
  }
}

function validateCatalogIntegrity(
  sourceMessages,
  catalogMessages,
  maximumSourceCopiedMessages,
) {
  validateCatalogKeys(sourceMessages, catalogMessages)
  for (const [key, source] of Object.entries(sourceMessages)) {
    const error = messageContractError(key, source, catalogMessages[key])
    if (error) throw new Error(error)
  }

  const sourceCopiedMessages = Object.entries(sourceMessages).filter(
    ([key, source]) =>
      !INTENTIONALLY_LOCALE_NEUTRAL.has(key) && catalogMessages[key] === source,
  ).length
  if (sourceCopiedMessages > maximumSourceCopiedMessages) {
    throw new Error(
      `Catalog retains ${sourceCopiedMessages} exact English messages; maximum is ${maximumSourceCopiedMessages}`,
    )
  }
}

function validateTranslation(sourceMessages, translations, minimumChangeRatio) {
  if (!Array.isArray(translations)) {
    throw new Error("Response translations must be an array")
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
      throw new Error("Every translation must contain string key and value")
    }
    if (translated.has(entry.key)) {
      throw new Error(`Duplicate translated key: ${entry.key}`)
    }
    translated.set(entry.key, entry.value)
  }

  const missing = expectedKeys.filter((key) => !translated.has(key))
  const unexpected = [...translated.keys()].filter(
    (key) => !Object.hasOwn(sourceMessages, key),
  )
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Translation key mismatch; missing=${missing.slice(0, 8).join(",")}; unexpected=${unexpected.slice(0, 8).join(",")}`,
    )
  }

  for (const [key, source] of Object.entries(sourceMessages)) {
    const value = translated.get(key)
    const error = messageContractError(key, source, value)
    if (error) throw new Error(error)
  }

  const changedMessages = Object.entries(sourceMessages).filter(
    ([key, source]) => translated.get(key) !== source,
  ).length
  if (
    minimumChangeRatio > 0 &&
    changedMessages / Object.keys(sourceMessages).length < minimumChangeRatio
  ) {
    throw new Error(
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
- Every supplied message is intentionally translatable and currently requires work. Return a value different from its English source for every entry; explicit locale-neutral exceptions are excluded before this request.
- Return one entry for every requested key and no extra keys.`
}

function buildUserPrompt({ locale, inventoryEntry, messages, references }) {
  const countries = (inventoryEntry?.countries ?? [])
    .map((country) => country.name)
    .join(", ")
  return JSON.stringify(
    {
      targetLocale: locale,
      targetLanguage: localeDisplayName(locale),
      scriptAndRegion: locale,
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

class PermanentApiError extends Error {}

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
      throw new Error(previousError)
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
      throw new Error(previousError)
    }

    try {
      const payload = await response.json()
      const outputContent = useResponsesApi
        ? (payload.output ?? []).flatMap((item) => item.content ?? [])
        : []
      const refusal = useResponsesApi
        ? outputContent.find((item) => item.type === "refusal")?.refusal
        : payload.choices?.[0]?.message?.refusal
      if (refusal) throw new Error(`Model refused: ${refusal}`)

      const content = useResponsesApi
        ? (payload.output_text ??
          outputContent.find((item) => item.type === "output_text")?.text)
        : payload.choices?.[0]?.message?.content
      if (typeof content !== "string") {
        throw new Error("Model returned no JSON content")
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

  throw new Error(previousError || "Translation failed validation")
}

function loadProgress(path, model, sourceDigest) {
  if (!existsSync(path)) {
    return {
      model,
      sourceDigest,
      completedLocales: [],
      generatedLocales: [],
      catalogDigests: {},
      usage: {},
    }
  }
  const progress = readJson(path)
  if (progress.model !== model) {
    throw new Error(
      `Progress file model ${progress.model} does not match requested model ${model}`,
    )
  }
  if (progress.sourceDigest !== sourceDigest) {
    throw new Error(
      "Progress file does not match the current English catalog and translation policy. Use a fresh --progress path.",
    )
  }
  progress.catalogDigests ??= {}
  return progress
}

function recordUsage(progress, usage) {
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    progress.usage[key] = (progress.usage[key] ?? 0) + (usage[key] ?? 0)
  }
}

function updateManifestAfterTranslation({
  manifest,
  inventory,
  completedLocales,
  generatedLocales,
  model,
  sourceDigest,
  catalogDigests,
  generatedOn = new Date().toISOString().slice(0, 10),
}) {
  const completed = new Set(completedLocales)
  const generated = new Set(generatedLocales)
  const inventoryLocales = inventory.languages.map((language) => language.tag)
  const remainingProvisional = manifest.provisionalLocales.filter(
    (locale) => !completed.has(locale),
  )
  const machineTranslatedLocales = sortedUnique([
    ...(manifest.machineTranslatedLocales ?? []),
    ...generatedLocales,
  ])
  const previousTranslation = manifest.metadata.translation ?? {}
  const previousLocaleProvenance = previousTranslation.localeProvenance ?? {}
  const localeProvenance = Object.fromEntries(
    machineTranslatedLocales.map((locale) => {
      const catalogDigest = catalogDigests[locale]
      if (typeof catalogDigest !== "string" || catalogDigest.length === 0) {
        throw new Error(
          `Cannot promote machine-translated locale ${locale}: current catalog digest is missing`,
        )
      }

      if (generated.has(locale)) {
        return [locale, { model, sourceDigest, catalogDigest, generatedOn }]
      }

      const previous = previousLocaleProvenance[locale]
      if (!previous) {
        throw new Error(
          `Cannot promote machine-translated locale ${locale}: final per-locale provenance is missing`,
        )
      }

      return [
        locale,
        {
          ...previous,
          sourceDigest,
          catalogDigest,
        },
      ]
    }),
  )
  const localeCountByModel = {}
  for (const provenance of Object.values(localeProvenance)) {
    localeCountByModel[provenance.model] ??= 0
    localeCountByModel[provenance.model] += 1
  }
  const previousPrimaryModel = previousTranslation.model
  const primaryModel =
    Object.entries(localeCountByModel).sort(
      ([leftModel, leftCount], [rightModel, rightCount]) =>
        rightCount - leftCount ||
        Number(rightModel === previousPrimaryModel) -
          Number(leftModel === previousPrimaryModel) ||
        leftModel.localeCompare(rightModel),
    )[0]?.[0] ?? model
  const fallbackModelsByModel = {}
  for (const [locale, provenance] of Object.entries(localeProvenance)) {
    if (provenance.model === primaryModel) continue
    fallbackModelsByModel[provenance.model] ??= []
    fallbackModelsByModel[provenance.model].push(locale)
  }
  const fallbackModels = Object.fromEntries(
    Object.entries(fallbackModelsByModel)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fallbackModel, locales]) => [
        fallbackModel,
        sortedUnique(locales),
      ]),
  )
  const previousTranslationMetadata = Object.fromEntries(
    Object.entries(previousTranslation).filter(
      ([key]) => key !== "fallbackModels" && key !== "localeProvenance",
    ),
  )

  return {
    metadata: {
      ...manifest.metadata,
      generatedOn,
      policy:
        "Every shipped UI catalog contains locale-specific copy. Existing authored translations are preserved; machineTranslatedLocales identifies catalogs completed or created with approved contextual AI translation and recommended for native-speaker review.",
      translation: {
        ...previousTranslationMetadata,
        method: "OpenAI contextual machine translation",
        model: primaryModel,
        ...(Object.keys(fallbackModels).length > 0 ? { fallbackModels } : {}),
        localeProvenance,
        sourceCatalog: `apps/web/messages/${SOURCE_LOCALE}.json`,
        approvedByUser: true,
        preservedExistingTranslations: true,
        generatedOn,
        reviewStatus: "machine-translated; native-speaker review recommended",
      },
    },
    summary: {
      inventoryLanguageTags: inventoryLocales.length,
      authoredInventoryCatalogs:
        inventoryLocales.length - remainingProvisional.length,
      machineTranslatedCatalogs: machineTranslatedLocales.length,
      provisionalCatalogs: remainingProvisional.length,
      existingNonInventoryCatalogs: manifest.existingNonInventoryLocales.length,
      missingCatalogs: manifest.missingCatalogs.length,
    },
    authoredInventoryLocales: inventoryLocales
      .filter((locale) => !remainingProvisional.includes(locale))
      .sort((a, b) => a.localeCompare(b)),
    machineTranslatedLocales,
    provisionalLocales: remainingProvisional,
    existingNonInventoryLocales: manifest.existingNonInventoryLocales,
    missingCatalogs: manifest.missingCatalogs,
  }
}

function validateCompletedProvisionalCatalogs({
  manifest,
  completedLocales,
  progress,
  messagesDir,
  sourceFlat,
  maximumSourceCopiedMessages,
}) {
  const completed = new Set(completedLocales)
  for (const locale of manifest.provisionalLocales) {
    if (!completed.has(locale)) continue

    const path = join(messagesDir, `${locale}.json`)
    if (!existsSync(path)) {
      throw new Error(
        `Cannot promote completed provisional locale ${locale}: catalog is missing`,
      )
    }
    const flatCatalog = flattenCatalog(readJson(path))
    const catalogDigest = contentDigest(flatCatalog)
    if (progress.catalogDigests[locale] !== catalogDigest) {
      throw new Error(
        `Cannot promote completed provisional locale ${locale}: catalog changed after its progress digest was recorded`,
      )
    }
    validateCatalogIntegrity(
      sourceFlat,
      flatCatalog,
      maximumSourceCopiedMessages,
    )
  }
}

function validatedCatalogDigests({
  locales,
  messagesDir,
  sourceFlat,
  maximumSourceCopiedMessages,
}) {
  return Object.fromEntries(
    locales.map((locale) => {
      const path = join(messagesDir, `${locale}.json`)
      if (!existsSync(path)) {
        throw new Error(
          `Cannot record provenance for machine-translated locale ${locale}: catalog is missing`,
        )
      }
      const flatCatalog = flattenCatalog(readJson(path))
      validateCatalogIntegrity(
        sourceFlat,
        flatCatalog,
        maximumSourceCopiedMessages,
      )
      return [locale, contentDigest(flatCatalog)]
    }),
  )
}

async function main({ args = process.argv, environment = process.env } = {}) {
  const messagesDir = argValue("--messages-dir", DEFAULT_MESSAGES_DIR, args)
  const inventoryPath = argValue("--inventory", DEFAULT_INVENTORY_PATH, args)
  const manifestPath = argValue("--manifest", DEFAULT_MANIFEST_PATH, args)
  const progressPath = argValue("--progress", DEFAULT_PROGRESS_PATH, args)
  const model = argValue("--model", DEFAULT_MODEL, args)
  const concurrency = integerArg("--concurrency", DEFAULT_CONCURRENCY, args)
  const maxAttempts = integerArg("--max-attempts", DEFAULT_MAX_ATTEMPTS, args)
  const shouldPromote = args.includes("--promote")
  const apiKey = environment.OPENAI_API_KEY ?? environment.API_OPENAI
  if (!apiKey) {
    throw new Error("Set OPENAI_API_KEY or API_OPENAI")
  }

  const sourceCatalog = readJson(join(messagesDir, `${SOURCE_LOCALE}.json`))
  const sourceFlat = flattenCatalog(sourceCatalog)
  const translatableSourceMessageCount = Object.keys(sourceFlat).filter(
    (key) => !INTENTIONALLY_LOCALE_NEUTRAL.has(key),
  ).length
  const maximumSourceCopiedMessages = Math.floor(
    translatableSourceMessageCount * MAXIMUM_SOURCE_COPY_RATIO,
  )
  const inventory = readJson(inventoryPath)
  const manifest = readJson(manifestPath)
  const inventoryByLocale = new Map(
    inventory.languages.map((language) => [language.tag, language]),
  )
  const requestedLocales = argValue("--locales", "", args)
  const locales = requestedLocales
    ? requestedLocales.split(",").map((locale) => locale.trim())
    : [
        ...manifest.authoredInventoryLocales,
        ...manifest.provisionalLocales,
        ...manifest.existingNonInventoryLocales,
      ]
  const selectedLocales = sortedUnique(
    locales.filter((locale) => locale && locale !== SOURCE_LOCALE),
  )
  const sourceDigest = sourceDigestForFlatCatalog(sourceFlat)
  const progress = loadProgress(progressPath, model, sourceDigest)
  const completed = new Set(progress.completedLocales)
  const generated = new Set(
    progress.generatedLocales.filter((locale) => completed.has(locale)),
  )
  const machineTranslatedLocales = new Set(
    manifest.machineTranslatedLocales ?? [],
  )
  const localeProvenance =
    manifest.metadata?.translation?.localeProvenance ?? {}
  const queue = selectedLocales
  const failures = []
  let fatalError = null

  console.log(
    JSON.stringify({
      event: "translation_start",
      model,
      selected: selectedLocales.length,
      resumed: completed.size,
      remaining: queue.length,
      concurrency,
    }),
  )

  let cursor = 0
  async function worker() {
    while (cursor < queue.length && fatalError === null) {
      const index = cursor
      cursor += 1
      const locale = queue[index]
      const path = join(messagesDir, `${locale}.json`)
      try {
        if (!existsSync(path)) throw new Error(`Missing catalog ${path}`)
        const catalog = readJson(path)
        const flatCatalog = flattenCatalog(catalog)
        const catalogDigest = contentDigest(flatCatalog)
        const { missing, unexpected } = catalogKeyDifferences(
          sourceFlat,
          flatCatalog,
        )
        if (unexpected.length > 0) {
          throw new Error(
            `Catalog contains unexpected keys: ${unexpected.slice(0, 8).join(",")}`,
          )
        }
        for (const key of missing) flatCatalog[key] = sourceFlat[key]

        const requiresFinalProvenance =
          machineTranslatedLocales.has(locale) &&
          !localeProvenance[locale] &&
          !generated.has(locale)

        if (
          missing.length === 0 &&
          !requiresFinalProvenance &&
          completed.has(locale) &&
          progress.catalogDigests[locale] === catalogDigest
        ) {
          try {
            validateCatalogIntegrity(
              sourceFlat,
              flatCatalog,
              maximumSourceCopiedMessages,
            )
            console.log(
              JSON.stringify({
                event: "locale_resumed",
                locale,
                completed: completed.size,
              }),
            )
            continue
          } catch (error) {
            console.warn(
              JSON.stringify({
                event: "locale_resume_invalid",
                locale,
                message: error instanceof Error ? error.message : String(error),
              }),
            )
          }
        }

        const isProvisional = manifest.provisionalLocales.includes(locale)
        const shouldTranslateEntireCatalog =
          (isProvisional && !completed.has(locale)) || requiresFinalProvenance
        const missingKeys = new Set(missing)
        const keysToTranslate = Object.keys(sourceFlat).filter(
          (key) =>
            !INTENTIONALLY_LOCALE_NEUTRAL.has(key) &&
            (missingKeys.has(key) ||
              shouldTranslateEntireCatalog ||
              flatCatalog[key] === sourceFlat[key] ||
              messageContractError(key, sourceFlat[key], flatCatalog[key]) !==
                null),
        )
        const keysToTranslateSet = new Set(keysToTranslate)
        const messages = Object.fromEntries(
          keysToTranslate.map((key) => [key, sourceFlat[key]]),
        )
        const minimumChangeRatio = keysToTranslate.length > 0 ? 1 : 0
        const references = Object.fromEntries(
          Object.keys(sourceFlat)
            .filter(
              (key) =>
                !keysToTranslateSet.has(key) &&
                flatCatalog[key] !== sourceFlat[key],
            )
            .map((key) => [key, flatCatalog[key]]),
        )

        if (keysToTranslate.length > 0) {
          const result = await requestTranslations({
            apiKey,
            locale,
            inventoryEntry: inventoryByLocale.get(locale),
            messages,
            references,
            model,
            maxAttempts,
            minimumChangeRatio,
          })
          for (const [key, value] of Object.entries(result.translations)) {
            flatCatalog[key] = value
          }
          recordUsage(progress, result.usage)
        }

        validateCatalogIntegrity(
          sourceFlat,
          flatCatalog,
          maximumSourceCopiedMessages,
        )
        if (missing.length > 0 || keysToTranslate.length > 0) {
          writeJsonAtomic(path, unflattenCatalog(flatCatalog))
        }
        if (keysToTranslate.length > 0) generated.add(locale)
        completed.add(locale)
        progress.catalogDigests[locale] = contentDigest(flatCatalog)
        progress.completedLocales = sortedUnique([...completed])
        progress.generatedLocales = sortedUnique([...generated])
        writeJsonAtomic(progressPath, progress)
        console.log(
          JSON.stringify({
            event: "locale_complete",
            locale,
            translatedMessages: keysToTranslate.length,
            completed: completed.size,
            selected: selectedLocales.length,
          }),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ locale, message })
        if (error instanceof PermanentApiError) {
          fatalError = error
          cursor = queue.length
        }
        console.error(
          JSON.stringify({ event: "locale_failed", locale, message }),
        )
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length || 1) }, () =>
      worker(),
    ),
  )

  if (failures.length > 0) {
    console.error(JSON.stringify({ event: "translation_failed", failures }))
    process.exitCode = 1
    return
  }

  if (shouldPromote) {
    validateCompletedProvisionalCatalogs({
      manifest,
      completedLocales: [...completed],
      progress,
      messagesDir,
      sourceFlat,
      maximumSourceCopiedMessages,
    })
    const machineTranslatedLocales = sortedUnique([
      ...(manifest.machineTranslatedLocales ?? []),
      ...generated,
    ])
    const catalogDigests = validatedCatalogDigests({
      locales: machineTranslatedLocales,
      messagesDir,
      sourceFlat,
      maximumSourceCopiedMessages,
    })
    const nextManifest = updateManifestAfterTranslation({
      manifest,
      inventory,
      completedLocales: [...completed],
      generatedLocales: [...generated],
      model,
      sourceDigest,
      catalogDigests,
    })
    writeJsonAtomic(manifestPath, nextManifest)
  }

  console.log(
    JSON.stringify({
      event: "translation_complete",
      completed: completed.size,
      generated: generated.size,
      promoted: shouldPromote,
      usage: progress.usage,
    }),
  )
}

export {
  contentDigest,
  flattenCatalog,
  main,
  requestTranslations,
  sourceDigestForFlatCatalog,
  updateManifestAfterTranslation,
  validateCatalogIntegrity,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
}
