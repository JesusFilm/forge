#!/usr/bin/env node
// Writes src/i18n/adminLanguages.generated.ts (KTD9). It reads web's files as
// text at development time; the app never imports apps/web. Not a package.json
// script (KTD4): run `node scripts/i18n/generate-admin-languages.mjs [--check]`.

import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOBILE = path.resolve(HERE, "../..")
const REPO = path.resolve(MOBILE, "../..")

const OUT_FILE = path.join(MOBILE, "src", "i18n", "adminLanguages.generated.ts")
const MAP_FILE = path.join("src", "lib", "language-bcp47-map.ts")
const LOCALE_FILE = path.join("src", "lib", "locale.ts")
const CURATED_TABLE = "PUBLIC_WATCH_AUDIO_LANGUAGE_SLUG_BY_UI_LOCALE"

// A null slug returns every language's rows, so English is a real slug (KTD9).
const ENGLISH = { textSlug: "english", rawTag: "en" }

const CATALOG_TAG = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/
const AUDIO_KEY = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/
const SECTIONS = ["text", "audio", "forYou"]

class AdminLanguageError extends Error {}

function parseArgs(argv) {
  const options = {
    mode: "write",
    webDir: path.join(REPO, "apps", "web"),
    overrides: path.join(MOBILE, "i18n", "admin-language-overrides.json"),
    out: OUT_FILE,
  }
  for (const arg of argv) {
    if (arg === "--check") options.mode = "check"
    else if (arg === "--json") options.mode = "json"
    else if (arg.startsWith("--web-dir=")) {
      options.webDir = path.resolve(arg.slice("--web-dir=".length))
    } else if (arg.startsWith("--overrides=")) {
      options.overrides = path.resolve(arg.slice("--overrides=".length))
    } else if (arg.startsWith("--out=")) {
      options.out = path.resolve(arg.slice("--out=".length))
    } else {
      throw new AdminLanguageError(`Unknown argument: ${arg}`)
    }
  }
  return options
}

/** `[slug, tag]` pairs in web's order. The header count catches parser drift. */
function readLanguageMap(webDir) {
  const source = fs.readFileSync(path.join(webDir, MAP_FILE), "utf8")
  const body = source.split("Object.freeze({")[1] ?? ""
  const entries = [
    ...body.matchAll(/^\s+(?:"([^"]+)"|([a-z0-9-]+)):\s*"([^"]*)",?\s*$/gm),
  ].map((match) => [match[1] ?? match[2], match[3]])
  const header = source.match(/^\/\/ (\d+) entries\b/m)
  if (!header || Number(header[1]) !== entries.length) {
    throw new AdminLanguageError(
      `${MAP_FILE}: read ${entries.length} entries, but its header says ` +
        `${header?.[1] ?? "nothing"}. The file format changed; update readLanguageMap.`,
    )
  }
  return entries.filter(([, tag]) => tag.length > 0)
}

function readCuratedTable(webDir, slugs) {
  const source = fs.readFileSync(path.join(webDir, LOCALE_FILE), "utf8")
  const block = source.match(
    new RegExp(
      `${CURATED_TABLE}[\\s\\S]*?Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`,
    ),
  )
  const pairs = [
    ...(block?.[1] ?? "").matchAll(
      /^\s*(?:"([^"]+)"|([A-Za-z][\w-]*)):\s*"([^"]+)",?\s*$/gm,
    ),
  ].map((match) => [match[1] ?? match[2], match[3]])
  if (pairs.length === 0) {
    throw new AdminLanguageError(
      `${LOCALE_FILE}: found no ${CURATED_TABLE} entries. Update readCuratedTable.`,
    )
  }
  for (const [tag, slug] of pairs) {
    if (!slugs.has(slug)) {
      throw new AdminLanguageError(
        `${LOCALE_FILE}: ${CURATED_TABLE} sends ${tag} to ${slug}, which is not in ${MAP_FILE}.`,
      )
    }
  }
  return new Map(pairs)
}

function readCatalogTags(webDir) {
  const tags = fs
    .readdirSync(path.join(webDir, "messages"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort()
  const bad = tags.filter((tag) => !CATALOG_TAG.test(tag))
  if (bad.length > 0 || !tags.includes("en")) {
    throw new AdminLanguageError(
      `web messages: expected catalog tags including en; bad names: ${bad.join(", ") || "none"}.`,
    )
  }
  return tags
}

function readOverrides(file, catalogs, slugs) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"))
  const name = path.basename(file)
  const fail = (message) => {
    throw new AdminLanguageError(`${name}: ${message}`)
  }
  for (const key of Object.keys(raw)) {
    if (!SECTIONS.includes(key) && !key.startsWith("$")) {
      fail(`unknown section ${key}.`)
    }
  }
  const result = {}
  for (const section of SECTIONS) {
    const valueField = section === "forYou" ? "locale" : "slug"
    const entries = Object.entries(raw[section] ?? {})
    for (const [key, entry] of entries) {
      const at = `${section}.${key}`
      const fields = Object.keys(entry ?? {})
        .sort()
        .join(",")
      if (fields !== [valueField, "reason"].sort().join(",")) {
        fail(
          `${at} must have exactly ${valueField} and reason; it has ${fields}.`,
        )
      }
      if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
        fail(`${at} needs a reason.`)
      }
      if (section === "audio" ? !AUDIO_KEY.test(key) : !catalogs.has(key)) {
        fail(
          section === "audio"
            ? `${at}: the key must be a lowercase tag.`
            : `${at}: ${key} is not a web catalog.`,
        )
      }
      if (valueField === "slug" && !slugs.has(entry.slug)) {
        fail(`${at}: ${entry.slug} is not in ${MAP_FILE}.`)
      }
      if (valueField === "locale" && !CATALOG_TAG.test(entry.locale)) {
        fail(`${at}: ${entry.locale} is not a locale tag.`)
      }
    }
    result[section] = new Map(
      entries.map(([key, entry]) => [key, entry[valueField]]),
    )
  }
  return result
}

function buildTables({ entries, curated, catalogs, overrides }) {
  const tagBySlug = new Map(entries)
  const firstSlugByTag = new Map()
  for (const [slug, tag] of entries) {
    const key = tag.toLowerCase()
    if (!firstSlugByTag.has(key)) firstSlugByTag.set(key, slug)
  }

  const forms = {}
  const englishContent = []
  for (const tag of catalogs) {
    const slug =
      overrides.text.get(tag) ??
      curated.get(tag) ??
      firstSlugByTag.get(tag.toLowerCase())
    if (slug == null) englishContent.push(tag)
    forms[tag] = {
      catalogTag: tag,
      forYouLocale: overrides.forYou.get(tag) ?? tag,
      textSlug: slug ?? ENGLISH.textSlug,
      rawTag: slug == null ? ENGLISH.rawTag : tagBySlug.get(slug),
    }
  }

  // Collision rule: an audio entry, else the first slug in web's map order.
  const audioBySlug = new Map([...firstSlugByTag, ...overrides.audio])
  const audio = Object.fromEntries(
    [...audioBySlug].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  return { forms, audio, englishContent }
}

function objectKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
}

function tableSource({ forms, audio }) {
  const formLines = Object.values(forms)
    .map(
      (row) =>
        `  ${objectKey(row.catalogTag)}: { catalogTag: ${JSON.stringify(row.catalogTag)}, ` +
        `forYouLocale: ${JSON.stringify(row.forYouLocale)}, ` +
        `textSlug: ${JSON.stringify(row.textSlug)}, rawTag: ${JSON.stringify(row.rawTag)} },`,
    )
    .join("\n")
  const audioLines = Object.entries(audio)
    .map(([tag, slug]) => `  ${objectKey(tag)}: ${JSON.stringify(slug)},`)
    .join("\n")
  return `// Generated by scripts/i18n/generate-admin-languages.mjs. Do not edit.
// Run \`node scripts/i18n/generate-admin-languages.mjs\` after a change to web's
// language map, web's catalogs, or i18n/admin-language-overrides.json.

export type AdminLanguageForms = {
  /** The catalog tag, for \`watchSetting\` and \`experienceBySlug\`. */
  readonly catalogTag: string
  /** The locale that For You pools use. */
  readonly forYouLocale: string
  /** The Language slug (the identity) for text rows, study questions, search, and Bible passages. */
  readonly textSlug: string
  /** Admin's own tag for \`textSlug\`, in Admin's case, for \`Language.name\` and \`BibleBook.name\`. */
  readonly rawTag: string
}

// One entry per web catalog. A catalog with no Admin language reads English.
export const ADMIN_LANGUAGE_FORMS: Readonly<Record<string, AdminLanguageForms>> = {
${formLines}
}

// A lowercase Admin or phone tag to one Language slug, for the default audio (KTD12).
export const AUDIO_SLUG_BY_TAG: Readonly<Record<string, string>> = {
${audioLines}
}
`
}

async function format(source) {
  const prettier = createRequire(path.join(REPO, "package.json"))("prettier")
  // Resolve the config for the real output path, so a test out file formats
  // exactly as the committed file does.
  const config = await prettier.resolveConfig(OUT_FILE)
  return prettier.format(source, { ...config, parser: "typescript" })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const entries = readLanguageMap(options.webDir)
  const slugs = new Set(entries.map(([slug]) => slug))
  const catalogs = readCatalogTags(options.webDir)
  const tables = buildTables({
    entries,
    curated: readCuratedTable(options.webDir, slugs),
    catalogs,
    overrides: readOverrides(options.overrides, new Set(catalogs), slugs),
  })

  if (options.mode === "json") {
    process.stdout.write(`${JSON.stringify(tables)}\n`)
    return
  }

  const source = await format(tableSource(tables))
  const shown = path.relative(process.cwd(), options.out)
  if (options.mode === "check") {
    const current = fs.existsSync(options.out)
      ? fs.readFileSync(options.out, "utf8")
      : null
    if (current !== source) {
      console.error(
        `${shown} is out of date.\n` +
          "Run `node scripts/i18n/generate-admin-languages.mjs` in apps/mobile.",
      )
      process.exit(1)
    }
    return
  }

  fs.writeFileSync(options.out, source)
  const english = tables.englishContent
  console.log(
    `Wrote ${shown}: ${catalogs.length} catalogs, ` +
      `${Object.keys(tables.audio).length} audio tags.\n` +
      `${english.length} catalogs read English content: ${english.join(" ")}`,
  )
}

main().catch((error) => {
  console.error(
    error instanceof AdminLanguageError ? error.message : error.stack,
  )
  process.exit(1)
})
