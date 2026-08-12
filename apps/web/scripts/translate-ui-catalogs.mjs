import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  isSourceEquivalent,
  messageContractError,
  PermanentApiError,
  requestTranslations,
} from "./openai-catalog-translator.mjs"
import { catalogPolicyFor } from "./ui-catalog-policy.mjs"

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
const DEFAULT_PROGRESS_PATH = `/tmp/forge-watch-ui-translation-progress-${createHash("sha256").update(repoDir).digest("hex").slice(0, 12)}.json`
const DEFAULT_MODEL = "gpt-5.4-mini-2026-03-17"
const DEFAULT_CONCURRENCY = 4
const DEFAULT_MAX_ATTEMPTS = 4
const SOURCE_LOCALE = "en"
const MAXIMUM_SOURCE_COPY_RATIO = 0
const MAXIMUM_NORMALIZED_SOURCE_COPY_RATIO = 0.05

class TranslationPipelineError extends Error {
  constructor(name, code, message, options) {
    super(message, options)
    this.name = name
    this.code = code
  }
}

class TranslationCliError extends TranslationPipelineError {
  constructor(code, message, options) {
    super("TranslationCliError", code, message, options)
  }
}

class CatalogValidationError extends TranslationPipelineError {
  constructor(code, message, options) {
    super("CatalogValidationError", code, message, options)
  }
}

class TranslationStateError extends TranslationPipelineError {
  constructor(code, message, options) {
    super("TranslationStateError", code, message, options)
  }
}

function argValue(name, fallback, args = process.argv) {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith("--")) {
    throw new TranslationCliError(
      "MISSING_ARGUMENT_VALUE",
      `Missing value for ${name}`,
    )
  }
  return value
}

function integerArg(name, fallback, args = process.argv) {
  const value = Number.parseInt(argValue(name, String(fallback), args), 10)
  if (!Number.isInteger(value) || value < 1) {
    throw new TranslationCliError(
      "INVALID_POSITIVE_INTEGER",
      `${name} must be a positive integer`,
    )
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
  const temporaryPath = `${path}.tmp-${process.pid}`
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
      throw new CatalogValidationError(
        "INVALID_MESSAGE_VALUE",
        `Invalid message value at ${path.join(".")}`,
      )
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
    if (parts.length < 2) {
      throw new CatalogValidationError(
        "INVALID_MESSAGE_PATH",
        `Invalid message path: ${path}`,
      )
    }
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
    throw new CatalogValidationError(
      "CATALOG_KEY_MISMATCH",
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
    if (error) {
      throw new CatalogValidationError("MESSAGE_CONTRACT_MISMATCH", error)
    }
  }

  const sourceCopiedMessages = Object.entries(sourceMessages).filter(
    ([key, source]) =>
      !INTENTIONALLY_LOCALE_NEUTRAL.has(key) && catalogMessages[key] === source,
  ).length
  if (sourceCopiedMessages > maximumSourceCopiedMessages) {
    throw new CatalogValidationError(
      "SOURCE_COPY_LIMIT_EXCEEDED",
      `Catalog retains ${sourceCopiedMessages} exact English messages; maximum is ${maximumSourceCopiedMessages}`,
    )
  }

  const normalizedSourceCopiedMessages = Object.entries(sourceMessages).filter(
    ([key, source]) =>
      !INTENTIONALLY_LOCALE_NEUTRAL.has(key) &&
      catalogMessages[key] !== source &&
      isSourceEquivalent(source, catalogMessages[key]),
  ).length
  const maximumNormalizedSourceCopiedMessages = Math.floor(
    Object.keys(sourceMessages).length * MAXIMUM_NORMALIZED_SOURCE_COPY_RATIO,
  )
  if (normalizedSourceCopiedMessages > maximumNormalizedSourceCopiedMessages) {
    throw new CatalogValidationError(
      "NORMALIZED_SOURCE_COPY_LIMIT_EXCEEDED",
      `Catalog retains ${normalizedSourceCopiedMessages} case/format-only English messages; maximum is ${maximumNormalizedSourceCopiedMessages}`,
    )
  }
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
    throw new TranslationStateError(
      "PROGRESS_MODEL_MISMATCH",
      `Progress file model ${progress.model} does not match requested model ${model}`,
    )
  }
  if (progress.sourceDigest !== sourceDigest) {
    throw new TranslationStateError(
      "PROGRESS_SOURCE_MISMATCH",
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
  scopeMessagePaths = [],
  generatedOn = new Date().toISOString().slice(0, 10),
}) {
  const completed = new Set(completedLocales)
  const generated = new Set(generatedLocales)
  const humanReviewedLocales = new Set(
    translationPolicy.humanReviewedLocales ?? [],
  )
  const inventoryLocales = inventory.languages.map((language) => language.tag)
  const remainingProvisional = manifest.provisionalLocales.filter(
    (locale) => !completed.has(locale),
  )
  const machineTranslatedLocales = sortedUnique([
    ...(manifest.machineTranslatedLocales ?? []),
    ...generatedLocales,
  ]).filter((locale) => !humanReviewedLocales.has(locale))
  const previousTranslation = manifest.metadata.translation ?? {}
  const previousLocaleProvenance = previousTranslation.localeProvenance ?? {}
  const localeProvenance = Object.fromEntries(
    machineTranslatedLocales.map((locale) => {
      const catalogDigest = catalogDigests[locale]
      if (typeof catalogDigest !== "string" || catalogDigest.length === 0) {
        throw new TranslationStateError(
          "MISSING_CATALOG_DIGEST",
          `Cannot promote machine-translated locale ${locale}: current catalog digest is missing`,
        )
      }

      if (generated.has(locale)) {
        const previous = previousLocaleProvenance[locale]
        if (scopeMessagePaths.length > 0 && previous) {
          return [
            locale,
            {
              ...previous,
              sourceDigest,
              catalogDigest,
              generatedOn,
              scopedRevisions: [
                ...(previous.scopedRevisions ?? []),
                { model, messagePaths: scopeMessagePaths, generatedOn },
              ],
            },
          ]
        }
        return [locale, { model, sourceDigest, catalogDigest, generatedOn }]
      }

      const previous = previousLocaleProvenance[locale]
      if (!previous) {
        throw new TranslationStateError(
          "MISSING_LOCALE_PROVENANCE",
          `Cannot promote machine-translated locale ${locale}: final per-locale provenance is missing`,
        )
      }

      return [locale, previous]
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
      policy: catalogPolicyFor(remainingProvisional.length),
      translation: {
        ...previousTranslationMetadata,
        method:
          "OpenAI contextual machine translation with localized phrase reuse",
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
      throw new TranslationStateError(
        "MISSING_PROVISIONAL_CATALOG",
        `Cannot promote completed provisional locale ${locale}: catalog is missing`,
      )
    }
    const flatCatalog = flattenCatalog(readJson(path))
    const catalogDigest = contentDigest(flatCatalog)
    if (progress.catalogDigests[locale] !== catalogDigest) {
      throw new TranslationStateError(
        "PROVISIONAL_DIGEST_MISMATCH",
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
        throw new TranslationStateError(
          "MISSING_MACHINE_CATALOG",
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
    throw new TranslationCliError(
      "MISSING_OPENAI_API_KEY",
      "Set OPENAI_API_KEY or API_OPENAI",
    )
  }

  const sourceCatalog = readJson(join(messagesDir, `${SOURCE_LOCALE}.json`))
  const sourceFlat = flattenCatalog(sourceCatalog)
  const requestedKeys = argValue("--keys", "", args)
  const scopedKeys = new Set(
    requestedKeys
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  )
  const unknownScopedKeys = [...scopedKeys].filter(
    (key) => !Object.hasOwn(sourceFlat, key),
  )
  if (unknownScopedKeys.length > 0) {
    throw new TranslationCliError(
      "UNKNOWN_MESSAGE_KEY",
      `Unknown message keys: ${unknownScopedKeys.join(",")}`,
    )
  }
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
  if (shouldPromote && scopedKeys.size > 0) {
    const scopedBaselineDigest = sourceDigestForFlatCatalog(
      Object.fromEntries(
        Object.entries(sourceFlat).filter(([key]) => !scopedKeys.has(key)),
      ),
    )
    const unsafeScopedPromotionLocales = selectedLocales.filter((locale) => {
      if (!machineTranslatedLocales.has(locale)) return false
      const previousSourceDigest = localeProvenance[locale]?.sourceDigest
      return (
        previousSourceDigest !== sourceDigest &&
        previousSourceDigest !== scopedBaselineDigest
      )
    })
    if (unsafeScopedPromotionLocales.length > 0) {
      throw new TranslationStateError(
        "SCOPED_PROMOTION_SOURCE_DRIFT",
        `Cannot promote a scoped translation when prior source drift is not limited to --keys: ${unsafeScopedPromotionLocales.slice(0, 12).join(",")}`,
      )
    }
  }
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
        if (!existsSync(path)) {
          throw new CatalogValidationError(
            "MISSING_CATALOG",
            `Missing catalog ${path}`,
          )
        }
        const catalog = readJson(path)
        const flatCatalog = flattenCatalog(catalog)
        const catalogDigest = contentDigest(flatCatalog)
        const { missing, unexpected } = catalogKeyDifferences(
          sourceFlat,
          flatCatalog,
        )
        if (unexpected.length > 0) {
          throw new CatalogValidationError(
            "UNEXPECTED_CATALOG_KEYS",
            `Catalog contains unexpected keys: ${unexpected.slice(0, 8).join(",")}`,
          )
        }
        for (const key of missing) flatCatalog[key] = sourceFlat[key]

        const requiresFinalProvenance =
          machineTranslatedLocales.has(locale) &&
          !localeProvenance[locale] &&
          !generated.has(locale)
        const hasStaleSourceProvenance =
          machineTranslatedLocales.has(locale) &&
          localeProvenance[locale]?.sourceDigest !== sourceDigest &&
          !generated.has(locale)

        if (
          scopedKeys.size === 0 &&
          missing.length === 0 &&
          !requiresFinalProvenance &&
          !hasStaleSourceProvenance &&
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
          scopedKeys.size === 0 &&
          ((isProvisional && !completed.has(locale)) ||
            requiresFinalProvenance ||
            hasStaleSourceProvenance)
        const missingKeys = new Set(missing)
        const keysToTranslate = Object.keys(sourceFlat).filter(
          (key) =>
            !INTENTIONALLY_LOCALE_NEUTRAL.has(key) &&
            (scopedKeys.size > 0
              ? scopedKeys.has(key)
              : missingKeys.has(key) ||
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
        const scopedNamespaces = new Set(
          [...scopedKeys].map((key) => key.split(".", 1)[0]),
        )
        const references = Object.fromEntries(
          Object.keys(sourceFlat)
            .filter(
              (key) =>
                !keysToTranslateSet.has(key) &&
                flatCatalog[key] !== sourceFlat[key] &&
                (scopedNamespaces.size === 0 ||
                  scopedNamespaces.has(key.split(".", 1)[0])),
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
      scopeMessagePaths: [...scopedKeys].sort((left, right) =>
        left.localeCompare(right),
      ),
    })
    const staleProvenanceLocales = nextManifest.machineTranslatedLocales.filter(
      (locale) =>
        nextManifest.metadata.translation.localeProvenance[locale]
          ?.sourceDigest !== sourceDigest,
    )
    if (staleProvenanceLocales.length > 0) {
      throw new TranslationStateError(
        "STALE_PROMOTION_PROVENANCE",
        `Cannot promote while machine-translated locales retain stale source provenance: ${staleProvenanceLocales.slice(0, 12).join(",")}`,
      )
    }
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
  isSourceEquivalent,
  main,
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
