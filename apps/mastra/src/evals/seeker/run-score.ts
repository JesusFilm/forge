#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 4. Derive the score artifact from a judged file.
 *
 * Free and offline: no model calls. Reads a judgements file, applies the
 * versioned weights (weights.ts) through score.ts, prints a summary, and
 * writes the score JSON (identity + weightsVersion stamped) for the gate /
 * baseline machinery to consume.
 *
 *   pnpm --filter @forge/mastra eval:seeker:score
 *   pnpm --filter @forge/mastra eval:seeker:score -- --in=... --out=...
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { flag, loadJudgedFile } from "./cli"
import { scoreJudgeRun } from "./score"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RUNS_DIR = resolve(MODULE_DIR, "../../../eval-runs/seeker")

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const inPath = resolve(
    process.cwd(),
    flag(argv, "in") ?? resolve(DEFAULT_RUNS_DIR, "judged.json"),
  )
  const outPath = resolve(
    process.cwd(),
    flag(argv, "out") ?? resolve(DEFAULT_RUNS_DIR, "score.json"),
  )

  const run = await loadJudgedFile(inPath)

  const score = scoreJudgeRun(run)

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(score, null, 2)}\n`, "utf8")

  console.log(`weights : ${score.weightsVersion}`)
  console.log(
    `run     : ${score.runScore == null ? "—" : `${score.runScore.toFixed(3)} (${score.runBand})`}`,
  )
  for (const model of score.byModel) {
    console.log(
      `  ${model.model}: ${model.score?.toFixed(3) ?? "—"} (${model.band ?? "—"}) over ${model.judgedCells} cells`,
    )
  }
  console.log(
    `cells   : ${score.judgedCells} judged, ${score.invalidCells} invalid, ${score.answerErrorCells} answer-error`,
  )
  console.log(`wrote ${outPath}`)
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
