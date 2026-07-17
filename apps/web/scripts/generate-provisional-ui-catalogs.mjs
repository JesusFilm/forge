import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative } from "node:path"
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
const DEFAULT_SOURCE_LOCALE = "en"
const LOCALE_TAG_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i
const PROVISIONAL_POLICY =
  "Missing inventory locales are provisional UI catalogs seeded from the English source catalog. Existing authored catalogs are preserved and are not marked provisional. Before authoring a listed provisional locale, remove it from provisionalLocales and run the generator without --refresh-provisional to promote its ownership; --refresh-provisional overwrites every locale that remains listed."
const COMPLETED_CATALOG_POLICY =
  "Every shipped UI catalog contains locale-specific copy. Existing authored translations are preserved; machineTranslatedLocales identifies catalogs completed with approved contextual AI translation and recommended for native-speaker review."

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"))
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function normalizeBcp47Tag(tag) {
  return tag
    .split("-")
    .map((part, index) => {
      if (index === 0) return part.toLowerCase()
      if (/^[a-z]{4}$/i.test(part)) {
        return part[0]?.toUpperCase() + part.slice(1).toLowerCase()
      }
      if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase()
      return part.toLowerCase()
    })
    .join("-")
}

function assertLocaleTag(locale) {
  if (!LOCALE_TAG_PATTERN.test(locale)) {
    throw new Error(`Invalid inventory language tag: ${locale}`)
  }
  const normalized = normalizeBcp47Tag(locale)
  if (locale !== normalized) {
    throw new Error(
      `Inventory language tag must be normalized: ${locale} -> ${normalized}`,
    )
  }
}

function catalogPath(messagesDir, locale) {
  return join(messagesDir, `${locale}.json`)
}

function discoverCatalogLocales(messagesDir) {
  return readdirSync(messagesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .sort((a, b) => a.localeCompare(b))
}

function inventoryLanguageTags(inventory) {
  const tags = inventory.languages?.map((language) => language.tag) ?? []
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error("Inventory is missing languages[].tag entries")
  }
  for (const tag of tags) assertLocaleTag(tag)
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b))
}

function catalogsMatch(a, b) {
  return renderJson(a) === renderJson(b)
}

export function planProvisionalCatalogs({
  inventory,
  existingCatalogLocales,
  previousProvisionalLocales,
  sourceCatalog,
}) {
  const inventoryLocales = inventoryLanguageTags(inventory)
  const existingSet = new Set(existingCatalogLocales)
  const previousProvisionalSet = new Set(previousProvisionalLocales)

  const missingLocales = inventoryLocales.filter(
    (locale) => !existingSet.has(locale),
  )
  const provisionalLocales = new Set(missingLocales)
  const authoredLocales = []

  for (const locale of inventoryLocales) {
    if (missingLocales.includes(locale)) continue
    if (previousProvisionalSet.has(locale)) {
      provisionalLocales.add(locale)
      continue
    }
    authoredLocales.push(locale)
  }

  return {
    inventoryLocales,
    missingLocales,
    provisionalLocales: [...provisionalLocales].sort((a, b) =>
      a.localeCompare(b),
    ),
    authoredLocales: authoredLocales.sort((a, b) => a.localeCompare(b)),
    existingNonInventoryLocales: existingCatalogLocales.filter(
      (locale) => !inventoryLocales.includes(locale),
    ),
    sourceCatalog,
  }
}

export function buildManifest({
  generatedOn,
  inventory,
  plan,
  sourceLocale,
  existingManifest,
}) {
  const catalogLocales = new Set([
    ...plan.inventoryLocales,
    ...plan.existingNonInventoryLocales,
  ])
  const machineTranslatedLocales = (
    existingManifest?.machineTranslatedLocales ?? []
  )
    .filter(
      (locale) =>
        locale !== sourceLocale &&
        catalogLocales.has(locale) &&
        !plan.provisionalLocales.includes(locale),
    )
    .sort((a, b) => a.localeCompare(b))

  return {
    metadata: {
      generatedOn,
      sourceInventory: "docs/i18n/watch-ui-official-language-inventory.json",
      sourceCatalog: `apps/web/messages/${sourceLocale}.json`,
      policy:
        plan.provisionalLocales.length > 0
          ? PROVISIONAL_POLICY
          : COMPLETED_CATALOG_POLICY,
      inventorySource: inventory.metadata?.source ?? null,
      cldrVersion: inventory.metadata?.cldrVersion ?? null,
      ...(existingManifest?.metadata?.translation
        ? { translation: existingManifest.metadata.translation }
        : {}),
    },
    summary: {
      inventoryLanguageTags: plan.inventoryLocales.length,
      authoredInventoryCatalogs: plan.authoredLocales.length,
      machineTranslatedCatalogs: machineTranslatedLocales.length,
      provisionalCatalogs: plan.provisionalLocales.length,
      existingNonInventoryCatalogs: plan.existingNonInventoryLocales.length,
      missingCatalogs: plan.missingLocales.length,
    },
    authoredInventoryLocales: plan.authoredLocales,
    machineTranslatedLocales,
    provisionalLocales: plan.provisionalLocales,
    existingNonInventoryLocales: plan.existingNonInventoryLocales,
    missingCatalogs: plan.missingLocales,
  }
}

function main() {
  const check = process.argv.includes("--check")
  const refreshProvisional = process.argv.includes("--refresh-provisional")
  if (check && refreshProvisional) {
    throw new Error("--check and --refresh-provisional cannot be used together")
  }
  const messagesDir = argValue("--messages-dir", DEFAULT_MESSAGES_DIR)
  const inventoryPath = argValue("--inventory", DEFAULT_INVENTORY_PATH)
  const manifestPath = argValue("--manifest", DEFAULT_MANIFEST_PATH)
  const sourceLocale = argValue("--source-locale", DEFAULT_SOURCE_LOCALE)
  const existingManifest = existsSync(manifestPath)
    ? readJson(manifestPath)
    : null
  const generatedOn = argValue(
    "--generated-on",
    existingManifest?.metadata?.generatedOn ??
      new Date().toISOString().slice(0, 10),
  )

  const sourcePath = catalogPath(messagesDir, sourceLocale)
  const sourceCatalog = readJson(sourcePath)
  const inventory = readJson(inventoryPath)
  const existingCatalogLocales = discoverCatalogLocales(messagesDir)
  const previousProvisionalLocales = existingManifest?.provisionalLocales ?? []
  if (!Array.isArray(previousProvisionalLocales)) {
    throw new Error("Existing provisional catalog manifest is malformed")
  }

  const plan = planProvisionalCatalogs({
    inventory,
    existingCatalogLocales,
    previousProvisionalLocales,
    sourceCatalog,
  })

  const manifestPlan = check ? plan : { ...plan, missingLocales: [] }
  const manifest = buildManifest({
    generatedOn,
    inventory,
    plan: manifestPlan,
    sourceLocale,
    existingManifest,
  })
  const manifestContent = renderJson(manifest)

  if (check) {
    for (const locale of plan.provisionalLocales) {
      const path = catalogPath(messagesDir, locale)
      if (!existsSync(path)) continue
      const catalog = readJson(path)
      if (!catalogsMatch(catalog, sourceCatalog)) {
        throw new Error(
          `Provisional catalog ${relative(repoDir, path)} does not match ${relative(repoDir, sourcePath)}. If it now contains authored copy, remove ${locale} from ${relative(repoDir, manifestPath)} before regenerating. Otherwise run pnpm --filter @forge/web generate:provisional-ui-catalogs -- --generated-on ${generatedOn} --refresh-provisional to intentionally refresh every listed provisional catalog.`,
        )
      }
    }

    const currentManifest = existsSync(manifestPath)
      ? readJson(manifestPath)
      : null
    const missingFiles = plan.missingLocales.filter(
      (locale) => !existsSync(catalogPath(messagesDir, locale)),
    )
    if (missingFiles.length > 0) {
      console.error(
        `Missing provisional UI catalogs: ${missingFiles.join(", ")}`,
      )
      process.exitCode = 1
      return
    }
    if (!currentManifest || !catalogsMatch(currentManifest, manifest)) {
      console.error(
        `${relative(repoDir, manifestPath)} is stale. Run pnpm --filter @forge/web generate:provisional-ui-catalogs -- --generated-on ${generatedOn}.`,
      )
      process.exitCode = 1
    }
    return
  }

  const divergentProvisionalLocales = plan.provisionalLocales.filter(
    (locale) => {
      const path = catalogPath(messagesDir, locale)
      return existsSync(path) && !catalogsMatch(readJson(path), sourceCatalog)
    },
  )
  if (divergentProvisionalLocales.length > 0 && !refreshProvisional) {
    throw new Error(
      `Refusing to overwrite divergent provisional catalogs: ${divergentProvisionalLocales.join(", ")}. Remove any newly authored locales from ${relative(repoDir, manifestPath)} before regenerating, or pass --refresh-provisional to intentionally replace every listed provisional catalog from ${relative(repoDir, sourcePath)}.`,
    )
  }

  mkdirSync(messagesDir, { recursive: true })
  const sourceContent = renderJson(sourceCatalog)
  for (const locale of plan.provisionalLocales) {
    writeFileSync(catalogPath(messagesDir, locale), sourceContent)
  }
  writeFileSync(manifestPath, manifestContent)

  console.log(
    `Ensured ${plan.inventoryLocales.length} inventory UI catalogs: ${plan.authoredLocales.length} authored, ${plan.provisionalLocales.length} provisional.`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
