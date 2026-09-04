#!/usr/bin/env tsx
/**
 * Regenerate (or `--check`) Web's public Watch language namespace from admin.
 *
 *   pnpm --filter @forge/web generate:language-bcp47-map [--admin-url <url>]
 *   pnpm --filter @forge/web check:language-bcp47-map    [--admin-url <url>]
 *
 * Writes:
 *   apps/web/src/lib/language-bcp47-map.ts
 *   packages/watch-url-policy/src/public-watch-language-slugs.ts
 *
 * `--check` exits 1 and prints the drift when the committed files lag admin.
 * Admin's `languages` query is public, so no bearer is required or sent.
 * The admin URL resolves from `--admin-url`, then `ADMIN_GRAPHQL_URL`, then
 * production. CI's `.env.ci` points `ADMIN_GRAPHQL_URL` at a localhost
 * placeholder, so the scheduled drift workflow passes `--admin-url` explicitly.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildLanguageBcp47Map,
  buildPublicWatchLanguageSlugs,
  diffLanguageCorpus,
  fetchAdminLanguages,
  hasLanguageCorpusDrift,
  parseLanguageBcp47MapSource,
  parsePublicWatchLanguageSlugsSource,
  renderLanguageBcp47MapSource,
  renderPublicWatchLanguageSlugsSource,
} from "../src/lib/language-bcp47-map-codegen"

const PRODUCTION_ADMIN_GRAPHQL_URL = "https://admin.jesusfilm.org/api/graphql"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const MAP_PATH = resolve(scriptDir, "../src/lib/language-bcp47-map.ts")
const CORPUS_PATH = resolve(
  scriptDir,
  "../../../packages/watch-url-policy/src/public-watch-language-slugs.ts",
)

type Args = { check: boolean; adminGraphqlUrl: string }

function parseArgs(argv: readonly string[]): Args {
  let check = false
  let adminGraphqlUrl: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--check") {
      check = true
    } else if (flag === "--admin-url" && argv[index + 1]) {
      adminGraphqlUrl = argv[index + 1]
      index += 1
    } else {
      throw new Error(
        `Unknown argument ${flag}. Usage: generate-language-bcp47-map [--check] [--admin-url <url>]`,
      )
    }
  }
  const resolvedUrl =
    adminGraphqlUrl ??
    process.env.ADMIN_GRAPHQL_URL ??
    PRODUCTION_ADMIN_GRAPHQL_URL
  // Validate early so a typo fails with a clear message, not a fetch error.
  new URL(resolvedUrl)
  return { check, adminGraphqlUrl: resolvedUrl }
}

function formatSlugList(slugs: readonly string[]): string {
  return slugs.length ? slugs.join(", ") : "(none)"
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  console.log(`Fetching admin languages from ${args.adminGraphqlUrl} …`)
  const rows = await fetchAdminLanguages({
    adminGraphqlUrl: args.adminGraphqlUrl,
  })
  const build = buildLanguageBcp47Map(rows)
  const nextSlugs = buildPublicWatchLanguageSlugs(build.map)
  console.log(
    `Fetched ${rows.length} rows → ${Object.keys(build.map).length} map entries, ${build.skipped.length} skipped.`,
  )
  for (const skipped of build.skipped) {
    console.log(
      `  skipped (${skipped.reason}): slug=${skipped.row.slug ?? "null"} bcp47=${skipped.row.bcp47 ?? "null"}`,
    )
  }

  const currentMap = parseLanguageBcp47MapSource(readFileSync(MAP_PATH, "utf8"))
  const currentSlugs = parsePublicWatchLanguageSlugsSource(
    readFileSync(CORPUS_PATH, "utf8"),
  )
  const diff = diffLanguageCorpus(currentMap, build.map)
  const corpusDrifted =
    currentSlugs.length !== nextSlugs.length ||
    currentSlugs.some((slug, index) => slug !== nextSlugs[index])
  const drifted = hasLanguageCorpusDrift(diff) || corpusDrifted

  console.log(`Added (${diff.added.length}): ${formatSlugList(diff.added)}`)
  console.log(
    `Removed (${diff.removed.length}): ${formatSlugList(diff.removed)}`,
  )
  console.log(
    `Changed (${diff.changed.length}): ${formatSlugList(
      diff.changed.map((entry) => `${entry.slug} ${entry.from}→${entry.to}`),
    )}`,
  )

  if (args.check) {
    if (drifted) {
      console.error(
        "\nDRIFT: the committed Watch language namespace lags admin. Run\n  pnpm --filter @forge/web generate:language-bcp47-map\nand commit both generated files.",
      )
      return 1
    }
    console.log("\nOK: committed Watch language namespace matches admin.")
    return 0
  }

  if (!drifted) {
    console.log("\nNo changes; generated files already match admin.")
    return 0
  }

  const generatedOn = new Date().toISOString().slice(0, 10)
  writeFileSync(
    MAP_PATH,
    renderLanguageBcp47MapSource(build.map, {
      generatedOn,
      skippedCount: build.skipped.length,
    }),
  )
  writeFileSync(CORPUS_PATH, renderPublicWatchLanguageSlugsSource(nextSlugs))
  console.log(`\nWrote ${MAP_PATH}\nWrote ${CORPUS_PATH}`)
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
