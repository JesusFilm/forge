#!/usr/bin/env tsx
/**
 * Regenerates docs/i18n/watch-ui-plural-category-gaps.json — the tracked
 * backlog of ICU plural blocks missing a CLDR-required category — from the
 * real catalogs in messages/, using the same detection logic the
 * completeness test enforces (src/i18n/plural-category-gaps.ts).
 *
 * The test is a ratchet: it fails on a NEW gap (not listed) and on a STALE
 * entry (listed but already fixed), so the list can only shrink. Run this
 * after fixing gaps to drop their entries in one go, then review the diff —
 * it should only ever remove lines. A diff that ADDS entries means a new
 * gap was introduced and should usually be fixed, not baselined.
 *
 *   pnpm --filter @forge/web tsx scripts/generate-plural-category-gaps.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { format, resolveConfig } from "prettier"
import {
  findPluralCategoryGaps,
  pluralGapKey,
  type MessageTree,
} from "../src/i18n/plural-category-gaps"

const MESSAGES_DIR = path.join(__dirname, "..", "messages")
const OUTPUT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "i18n",
  "watch-ui-plural-category-gaps.json",
)

async function main() {
  const knownGaps: Record<string, Record<string, string[]>> = {}
  const locales = readdirSync(MESSAGES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))
    .sort()

  for (const locale of locales) {
    const catalog = JSON.parse(
      readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8"),
    ) as MessageTree
    const gaps = findPluralCategoryGaps(locale, catalog)
    if (!gaps || gaps.length === 0) continue
    knownGaps[locale] = Object.fromEntries(
      gaps.map((gap) => [pluralGapKey(gap.path, gap.variable), gap.missing]),
    )
  }

  const totalKnownGaps = Object.values(knownGaps).reduce(
    (sum, entries) => sum + Object.keys(entries).length,
    0,
  )

  const output = {
    metadata: {
      policy:
        "Tracked backlog of ICU plural blocks that do not define every category the locale's own CLDR rules require (Intl.PluralRules(locale).resolvedOptions().pluralCategories) — the forge#N33 defect class. Missing categories silently fall back to `other` at runtime. The completeness test in apps/web/src/i18n/__tests__/messages-parity.test.ts is a ratchet: it fails on any gap NOT listed here and on any listed entry that is already fixed, so this file can only shrink. Fix a gap by adding the missing categories to that key's translated ICU string, then regenerate.",
      generatedBy:
        "pnpm --filter @forge/web tsx scripts/generate-plural-category-gaps.ts (detection logic: apps/web/src/i18n/plural-category-gaps.ts)",
      totalKnownGaps,
      localesAffected: Object.keys(knownGaps).length,
    },
    knownGaps,
  }

  // Emit prettier-clean output so a regeneration never trips CI's format job.
  const formatted = await format(JSON.stringify(output), {
    ...(await resolveConfig(OUTPUT)),
    parser: "json",
  })
  writeFileSync(OUTPUT, formatted, "utf8")
  console.log(
    `Wrote ${totalKnownGaps} known gaps across ${Object.keys(knownGaps).length} locales to ${path.relative(process.cwd(), OUTPUT)}`,
  )
}

if (require.main === module) {
  void main()
}
