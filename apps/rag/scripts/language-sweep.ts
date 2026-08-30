import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { z } from "zod"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { PostgresLanguageMaintenanceStore } from "../src/adapters/postgres/index.js"
import { allSources, getSource } from "../src/registry/index.js"
import { parseLanguageArgs } from "./lib/maintenance-args.js"
import {
  applySourceChanges,
  previewReverts,
  revertChanges,
  type LanguageChange,
} from "../src/indexing/language-maintenance.js"
import { cleanText } from "../src/indexing/normalize.js"
import { decideLanguageFromDetection } from "../src/indexing/decide-language.js"
import { installProductionEnvironment } from "./lib/production-target.js"
import { RagOperationalError } from "../src/contracts/index.js"

async function pool<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
) {
  let next = 0
  let failed = false
  let firstError: unknown
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && next < items.length) {
        try {
          await run(items[next++])
        } catch (error) {
          if (!failed) {
            failed = true
            firstError = error
          }
        }
      }
    }),
  )
  if (failed) throw firstError
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
      const languageChangeSchema = z.object({
        id: z.string().uuid(),
        sourceKey: z.string().min(1),
        oldLanguage: z.string().min(1).nullable(),
        newLanguage: z.string().min(1).nullable(),
        detectorModel: z.string().min(1).optional(),
      })
      const changes = (await readFile(args.changelog, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line, index) => {
          try {
            return languageChangeSchema.parse(
              JSON.parse(line),
            ) as LanguageChange
          } catch (error) {
            throw new RagOperationalError(
              "argument_invalid",
              `invalid language changelog line ${index + 1}`,
              { cause: error },
            )
          }
        })
      if (args.limit !== undefined && changes.length > args.limit)
        throw new RagOperationalError(
          "argument_invalid",
          `language changelog has ${changes.length} rows, above --limit ${args.limit}`,
        )
      const matched = await previewReverts(store, changes)
      if (!args.apply) {
        console.log(
          `DRY RUN: ${matched}/${changes.length} reversible; ` +
            `${changes.length - matched} refused; corpus unchanged`,
        )
        return
      }
      const reverted = await revertChanges(store, changes)
      console.log(
        `reverted ${reverted}/${changes.length} row(s); ` +
          `${changes.length - reverted} refused`,
      )
      return
    }
    const entries = args.all ? allSources() : [getSource(args.source as string)]
    if (entries.some((entry) => !entry))
      throw new RagOperationalError(
        "argument_invalid",
        `unknown source '${args.source}'`,
      )
    const stamp = new Date().toISOString().replaceAll(":", "-")
    const auditRunId = `language-sweep-${stamp}`
    const outDir = args.apply
      ? resolve(
          args.outDir ??
            process.env.LANGUAGE_SWEEP_OUT_DIR ??
            "reports/language-sweep",
        )
      : null
    const changelog = outDir
      ? resolve(outDir, `changelog-${stamp}.jsonl`)
      : null
    if (outDir && changelog) {
      await mkdir(outDir, { recursive: true })
      await writeFile(changelog, "")
    }
    const { wire } = await import("../src/main.js")
    const wiring = wire()
    try {
      for (const entry of entries) {
        if (!entry) continue
        const candidates = await store.listCandidates({
          sourceKey: entry.key,
          blanksOnly: args.mode === "blanks",
          limit: args.limit,
          afterId: args.afterId,
        })
        const changes: Array<Omit<LanguageChange, "sourceKey">> = []
        await pool(candidates, args.concurrency, async (candidate) => {
          const content = cleanText(candidate.rawContent)
          const detected = await wiring.languageDetector.detect(
            content.slice(0, 8_000),
            { declared: entry.languages },
          )
          const decision = detected.language
            ? decideLanguageFromDetection(
                content.length,
                {
                  language: detected.language,
                  confidence: detected.confidence,
                },
                { declared: entry.languages },
              )
            : { language: null }
          if (
            decision.language !== candidate.language &&
            decision.language !== null
          )
            changes.push({
              id: candidate.id,
              oldLanguage: candidate.language,
              newLanguage: decision.language,
            })
        })
        console.log(
          JSON.stringify({
            source: entry.key,
            scanned: candidates.length,
            proposed: changes.length,
            detectorModel: wiring.languageDetector.model,
            nextCursor: candidates.at(-1)?.id ?? null,
          }),
        )
        if (args.apply && changelog) {
          const applied = await applySourceChanges(
            store,
            entry.key,
            changes,
            (content) => appendFile(changelog, content),
            { runId: auditRunId, detectorModel: wiring.languageDetector.model },
          )
          console.log(
            JSON.stringify({
              source: entry.key,
              auditRunId,
              proposed: changes.length,
              applied: applied.length,
              refused: changes.length - applied.length,
            }),
          )
        }
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
