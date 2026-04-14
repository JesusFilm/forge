#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
/**
 * CLI entry point for the experience embeddings backfill.
 *
 * Boots Strapi via plain CJS require BEFORE registering tsx, because tsx's
 * module hooks interfere with Strapi's make-generator-function dependency.
 * After Strapi is loaded, tsx/cjs is registered to require the TypeScript
 * backfill module.
 *
 * Usage:
 *   pnpm --filter @forge/cms backfill:experience-embeddings [--dry-run] [--force]
 */

const { createStrapi } = require("@strapi/strapi")

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const force = args.includes("--force")

  // Boot Strapi first (pure CJS, no tsx interference)
  const strapi = createStrapi({ distDir: "./dist" })
  await strapi.load()

  // Now register tsx to load the TypeScript backfill module
  require("tsx/cjs")
  const { runBackfill } = require("./backfill-experience-embeddings.ts")

  try {
    const { failure } = await runBackfill(strapi, { dryRun, force })
    await strapi.db.connection.destroy().catch(() => {})
    process.exit(failure > 0 ? 1 : 0)
  } catch (err) {
    strapi.log.error(
      `[backfill-experience] Fatal: ${err instanceof Error ? err.message : String(err)}`,
    )
    await strapi.db.connection.destroy().catch(() => {})
    process.exit(1)
  }
}

main()
