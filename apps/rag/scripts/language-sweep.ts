import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { PrismaClient } from "../src/generated/prisma/index.js"
import { PostgresLanguageMaintenanceStore } from "../src/adapters/postgres/index.js"
import { allSources, getSource } from "../src/registry/index.js"
import { parseLanguageArgs } from "./lib/maintenance-args.js"
import {
  applySourceChanges,
  revertChanges,
  type LanguageChange,
} from "./lib/language-maintenance.js"
import { installProductionEnvironment } from "./lib/production-target.js"

async function pool<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++])
    }),
  )
}

async function main() {
  const argv = process.argv.slice(2)
  const args = parseLanguageArgs(argv)
  const production = argv.includes("--production")
  if (production) installProductionEnvironment(process.env, args.apply)
  const db = new PrismaClient()
  const store = new PostgresLanguageMaintenanceStore(db)
  try {
    if (args.kind === "revert") {
      const changes = (await readFile(args.changelog, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LanguageChange)
      if (!args.apply) {
        console.log(
          `DRY RUN: ${changes.length} guarded reversal(s); corpus unchanged`,
        )
        return
      }
      console.log(`reverted ${await revertChanges(store, changes)} row(s)`)
      return
    }
    const entries = args.all ? allSources() : [getSource(args.source as string)]
    if (entries.some((entry) => !entry))
      throw new Error(`unknown source '${args.source}'`)
    const outDir = resolve(
      args.outDir ??
        process.env.LANGUAGE_SWEEP_OUT_DIR ??
        "reports/language-sweep",
    )
    await mkdir(outDir, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(":", "-")
    const changelog = resolve(outDir, `changelog-${stamp}.jsonl`)
    await writeFile(changelog, "")
    const { wire } = await import("../src/main.js")
    const wiring = wire()
    try {
      for (const entry of entries) {
        if (!entry) continue
        const candidates = await store.listCandidates({
          sourceKey: entry.key,
          blanksOnly: args.mode === "blanks",
          limit: args.limit,
        })
        const changes: Array<Omit<LanguageChange, "sourceKey">> = []
        await pool(candidates, args.concurrency, async (candidate) => {
          const detected = await wiring.languageDetector.detect(
            candidate.rawContent.slice(0, 8_000),
            { declared: entry.languages },
          )
          if (
            detected.language !== candidate.language &&
            detected.language !== null
          )
            changes.push({
              id: candidate.id,
              oldLanguage: candidate.language,
              newLanguage: detected.language,
            })
        })
        console.log(
          JSON.stringify({
            source: entry.key,
            scanned: candidates.length,
            proposed: changes.length,
            detectorModel: wiring.languageDetector.model,
          }),
        )
        if (args.apply)
          await applySourceChanges(
            store,
            entry.key,
            changes,
            (line) => appendFile(changelog, line),
            wiring.languageDetector.model,
          )
      }
      if (!args.apply) console.log("DRY RUN: no corpus rows changed")
    } finally {
      await wiring.shutdown()
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error(`language sweep failed: ${(error as Error).message}`)
  process.exitCode = 1
})
