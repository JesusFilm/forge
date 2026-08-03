#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 3. Render something readable.
 *
 * Bands, not decimals — a grid of decimals invites ranking, and ranking on
 * one sample per cell flips a decision on noise. Errors and invalid judge
 * cells are reported in their own sections and never folded into the scores.
 *
 * Deterministic code checks run here, in their two lanes: HARD-FAIL
 * violations get their own section (they are the gate's input); REPORT-ONLY
 * findings (scripture references) are listed separately and never gate —
 * promotion is a later, separate decision (decision doc PR A step 5).
 *
 *   pnpm --filter @forge/mastra eval:seeker:report
 */
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { hardFailViolations, runAnswerChecks, type CheckResult } from "./checks"
import { loadableFixtureFile, type RagFixtureFile } from "./rag"
import { scoreJudgeRun } from "./score"
import {
  coerceAnswerRun,
  identityMismatch,
  JUDGE_RUN_KIND,
  type AnswerRun,
  type JudgeRun,
} from "./types"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_RUNS_DIR = resolve(MODULE_DIR, "../../../eval-runs/seeker")
const DEFAULT_FIXTURES = resolve(MODULE_DIR, "fixtures/rag-fixtures.json")

function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function shortModel(model: string): string {
  return model.split("/").pop()?.replace(":free", "") ?? model
}

async function loadAnswers(path: string): Promise<AnswerRun | null> {
  try {
    return coerceAnswerRun(JSON.parse(await readFile(path, "utf8")))
  } catch {
    return null
  }
}

async function loadFixtures(path: string): Promise<RagFixtureFile | null> {
  try {
    return loadableFixtureFile(JSON.parse(await readFile(path, "utf8")))
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const inPath = resolve(
    process.cwd(),
    flag(argv, "in") ?? resolve(DEFAULT_RUNS_DIR, "judged.json"),
  )
  const answersPath = resolve(
    process.cwd(),
    flag(argv, "answers") ?? resolve(DEFAULT_RUNS_DIR, "answers.json"),
  )
  const fixtures = await loadFixtures(
    resolve(process.cwd(), flag(argv, "fixtures") ?? DEFAULT_FIXTURES),
  )
  const run = JSON.parse(await readFile(inPath, "utf8")) as JudgeRun
  if (run.kind !== JUDGE_RUN_KIND) {
    throw new Error(`${inPath} is not a seeker-eval judgements file`)
  }
  const answers = await loadAnswers(answersPath)
  const outPath = resolve(
    process.cwd(),
    flag(argv, "out") ?? resolve(DEFAULT_RUNS_DIR, "report.md"),
  )

  // Never render a judgement file against answers it did not come from.
  // "generation" scope: the criteria hash may legitimately differ (rubric
  // iteration against cached answers); everything that shaped the ANSWERS
  // must agree.
  if (answers) {
    const problems = identityMismatch(
      run.identity,
      answers.identity,
      "generation",
    )
    if (problems.length > 0) {
      throw new Error(
        `judgement and answer files disagree on: ${problems.join(", ")} — refusing to pair them`,
      )
    }
  }

  const score = scoreJudgeRun(run)
  const models = run.identity.answeringModels

  const grid = (() => {
    const questionIds = [
      ...new Set(run.judged.map((entry) => entry.questionId)),
    ]
    const header = `| question | ${models.map(shortModel).join(" | ")} |`
    const divider = `| --- | ${models.map(() => "---").join(" | ")} |`
    const rows = questionIds.map((questionId) => {
      const cells = models.map((model) => {
        const cell = score.cells.find(
          (candidate) =>
            candidate.questionId === questionId && candidate.model === model,
        )
        if (!cell) return "—"
        if (cell.status !== "judged") return cell.status
        return `${cell.band} ${cell.score?.toFixed(2) ?? ""}`
      })
      return `| \`${questionId}\` | ${cells.join(" | ")} |`
    })
    return [header, divider, ...rows].join("\n")
  })()

  const sections: string[] = [
    "# seeker eval — judged report",
    "",
    "| | |",
    "| --- | --- |",
    `| prompt | \`${run.identity.promptSha256.slice(0, 12)}\` (${run.identity.promptSource}) |`,
    `| sections | \`${run.identity.sectionMappingVersion}\` |`,
    `| questions | \`${run.identity.questionSetId}\` (${run.identity.questionIds.length}) |`,
    `| judge | \`${run.identity.judge?.model ?? "—"}\` (rubric \`${run.identity.judge?.rubricSha256.slice(0, 12) ?? "—"}\`) |`,
    `| weights | \`${score.weightsVersion}\` |`,
    `| sample | \`${run.identity.sampleId}\` |`,
    `| finished | ${run.finishedAt} |`,
    "",
    "> Bands, not decimals. A single sample per cell cannot support a ranking.",
    "",
    `## Run score: ${score.runScore == null ? "—" : `${score.runScore.toFixed(3)} (${score.runBand})`}`,
    "",
    `Weighted pass rate over ${score.judgedCells} judged cells (weights \`${score.weightsVersion}\`).`,
    `Excluded: ${score.invalidCells} invalid judge cell(s), ${score.answerErrorCells} answer-error cell(s).`,
    "",
    "## Grid",
    "",
    grid,
    "",
    "## By model",
    "",
    "| model | score | band | judged | invalid | answer-error |",
    "| --- | --- | --- | --- | --- | --- |",
    ...score.byModel.map(
      (entry) =>
        `| ${shortModel(entry.model)} | ${entry.score?.toFixed(3) ?? "—"} | ${entry.band ?? "—"} | ${entry.judgedCells} | ${entry.invalidCells} | ${entry.answerErrorCells} |`,
    ),
    "",
    "## By prompt section",
    "",
    "Criteria tagged per section (prompt-sections.ts, " +
      `\`${run.identity.sectionMappingVersion}\`). Attribution by tag is a ` +
      "heuristic, not a proof — sections interact.",
    "",
    "| section | weighted pass rate | satisfied | violated |",
    "| --- | --- | --- | --- |",
    ...score.bySection.map(
      (entry) =>
        `| ${entry.section} | ${entry.score?.toFixed(3) ?? "—"} | ${entry.satisfiedCount} | ${entry.violatedCount} |`,
    ),
    "",
  ]

  // Deterministic checks — only meaningful when retrieval was in the loop
  // and the run SAYS so explicitly (an unstamped artifact must not be
  // reported on as though it had retrieval).
  const retrievalMode = run.identity.retrieval?.mode
  const checksByCell: Array<{
    cell: string
    results: CheckResult[]
  }> = []
  if (
    answers &&
    fixtures &&
    (retrievalMode === "fixtures" || retrievalMode === "tool-loop")
  ) {
    for (const answer of answers.answers) {
      checksByCell.push({
        cell: `${answer.questionId} x ${shortModel(answer.model)}`,
        results: runAnswerChecks(answer, fixtures),
      })
    }

    const hardFails = checksByCell.flatMap(({ cell, results }) =>
      hardFailViolations(results).map((result) => ({ cell, result })),
    )
    sections.push(
      "## Hard-fail checks (code, deterministic — the gate's input)",
      "",
      "URL and source-name membership against the served passages, tool",
      "called, word count, prose format.",
      "",
      hardFails.length === 0
        ? "No hard-fail violations."
        : `**${hardFails.length} violation(s):**`,
      "",
    )
    for (const { cell, result } of hardFails) {
      sections.push(
        `- \`${cell}\` — ${result.checkId}: ${result.details.join("; ")}`,
      )
    }
    if (hardFails.length > 0) sections.push("")

    const reportOnly = checksByCell.flatMap(({ cell, results }) =>
      results
        .filter(
          (result) =>
            result.lane === "report-only" && result.status === "violated",
        )
        .map((result) => ({ cell, result })),
    )
    sections.push(
      "## Report-only checks (never gate)",
      "",
      "Scripture-reference membership. Promotion to the hard-fail lane is a",
      "later, separate decision after validation against the committed run-3",
      "corpus (decision doc PR A step 5).",
      "",
      reportOnly.length === 0
        ? "No report-only findings."
        : `**${reportOnly.length} finding(s):**`,
      "",
    )
    for (const { cell, result } of reportOnly) {
      sections.push(
        `- \`${cell}\` — ${result.checkId}: ${result.details.join("; ")}`,
      )
    }
    if (reportOnly.length > 0) sections.push("")
  }

  const problemCells = run.judged.filter((entry) => entry.errors.length > 0)
  sections.push("## Errors and invalid cells (not counted as failures)", "")
  if (problemCells.length === 0) {
    sections.push("None.", "")
  } else {
    for (const entry of problemCells) {
      sections.push(
        `- \`${entry.questionId}\` x \`${shortModel(entry.model)}\` (${entry.status}${entry.retried ? ", retried" : ""}) — ${entry.errors.join("; ")}`,
      )
    }
    sections.push("")
  }

  sections.push("## Detail", "")
  for (const entry of run.judged) {
    const cell = score.cells.find(
      (candidate) =>
        candidate.questionId === entry.questionId &&
        candidate.model === entry.model,
    )
    sections.push(
      `### \`${entry.questionId}\` x \`${shortModel(entry.model)}\` — ${
        cell?.status === "judged"
          ? `${cell.band} ${cell.score?.toFixed(2) ?? ""}`
          : (cell?.status ?? "—")
      }`,
      "",
    )
    const answer = answers?.answers.find(
      (candidate) =>
        candidate.questionId === entry.questionId &&
        candidate.model === entry.model,
    )
    if (answer?.text) {
      sections.push(
        "<details><summary>answer</summary>",
        "",
        answer.text,
        "",
        "</details>",
        "",
      )
    }
    if (entry.verdicts) {
      sections.push(
        "| criterion | verdict | reasoning |",
        "| --- | --- | --- |",
      )
      for (const verdict of entry.verdicts) {
        const reasoning = verdict.reasoning
          .replace(/\|/g, "\\|")
          .replace(/\n/g, " ")
          .slice(0, 200)
        sections.push(
          `| \`${verdict.criterionId}\` | ${verdict.verdict} | ${reasoning} |`,
        )
      }
      sections.push("")
    }
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${sections.join("\n")}\n`, "utf8")

  console.log(grid)
  console.log("")
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
