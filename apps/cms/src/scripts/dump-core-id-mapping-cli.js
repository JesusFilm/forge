#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
/**
 * CLI entry point for the Core-ID mapping dump. Boots Strapi via plain
 * CJS require before registering tsx — same pattern as
 * backfill-experience-embeddings-cli.js.
 *
 * Usage:
 *   pnpm --filter @forge/cms dump:core-id-mapping > .tmp/core-id-mapping.json
 *   pnpm --filter @forge/cms dump:core-id-mapping --out /path/to/mapping.json
 */

const { createStrapi } = require("@strapi/strapi")

function parseOutFlag(args) {
  const idx = args.indexOf("--out")
  if (idx === -1) return undefined
  const value = args[idx + 1]
  if (!value) {
    process.stderr.write("[dump-core-id-mapping] --out requires a path\n")
    process.exit(2)
  }
  return value
}

async function main() {
  const args = process.argv.slice(2)
  const out = parseOutFlag(args)

  const strapi = createStrapi({ distDir: "./dist" })
  await strapi.load()

  require("tsx/cjs")
  const { runDump } = require("./dump-core-id-mapping.ts")

  try {
    await runDump(strapi, { out })
    await strapi.db.connection.destroy().catch(() => {})
    process.exit(0)
  } catch (err) {
    strapi.log.error(
      `[dump-core-id-mapping] Fatal: ${err instanceof Error ? err.message : String(err)}`,
    )
    await strapi.db.connection.destroy().catch(() => {})
    process.exit(1)
  }
}

main()
