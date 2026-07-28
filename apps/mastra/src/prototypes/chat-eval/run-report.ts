#!/usr/bin/env tsx
/**
 * PROTOTYPE — STEP 3. Render something readable.
 *
 * Bands, not decimals — a grid of decimals invites ranking, and ranking on one
 * sample per cell flips a decision on noise. Errors are reported in their own
 * section and never folded into the scores.
 *
 *   pnpm --filter @forge/mastra proto:report
 *   pnpm --filter @forge/mastra proto:report -- --in=prototype-runs/chat-eval/judged-scores.json
 */
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
  identityMismatch,
  type AnswerRun,
  type Band,
  type JudgedAnswer,
  type JudgeRun,
} from "./types"

const DEFAULT_IN = "prototype-runs/chat-eval/judged-verdicts.json"
const DEFAULT_ANSWERS = "prototype-runs/chat-eval/answers.json"

const BAND_GLYPH: Record<Band, string> = {
  pass: "pass",
  borderline: "border",
  fail: "FAIL",
  error: "err",
}

function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function shortModel(model: string): string {
  return model.split("/").pop()?.replace(":free", "") ?? model
}

function gridTable(judged: readonly JudgedAnswer[], models: readonly string[]) {
  const questionIds = [...new Set(judged.map((entry) => entry.questionId))]
  const header = `| question | ${models.map(shortModel).join(" | ")} |`
  const divider = `| --- | ${models.map(() => "---").join(" | ")} |`
  const rows = questionIds.map((questionId) => {
    const cells = models.map((model) => {
      const entry = judged.find(
        (candidate) =>
          candidate.questionId === questionId && candidate.model === model,
      )
      if (!entry) return "—"
      const score = entry.score == null ? "" : ` ${entry.score.toFixed(2)}`
      return `${BAND_GLYPH[entry.band]}${score}`
    })
    return `| \`${questionId}\` | ${cells.join(" | ")} |`
  })
  return [header, divider, ...rows].join("\n")
}

function categoryRollup(judged: readonly JudgedAnswer[]) {
  const categories = [...new Set(judged.map((entry) => entry.category))]
  const lines = categories.map((category) => {
    const rows = judged.filter((entry) => entry.category === category)
    const counts = {
      pass: rows.filter((row) => row.band === "pass").length,
      borderline: rows.filter((row) => row.band === "borderline").length,
      fail: rows.filter((row) => row.band === "fail").length,
      error: rows.filter((row) => row.band === "error").length,
    }
    return `| ${category} | ${counts.pass} | ${counts.borderline} | ${counts.fail} | ${counts.error} |`
  })
  return [
    "| category | pass | borderline | fail | error |",
    "| --- | --- | --- | --- | --- |",
    ...lines,
  ].join("\n")
}

async function loadAnswers(path: string): Promise<AnswerRun | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as AnswerRun
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const inPath = resolve(process.cwd(), flag(argv, "in") ?? DEFAULT_IN)
  const answersPath = resolve(
    process.cwd(),
    flag(argv, "answers") ?? DEFAULT_ANSWERS,
  )
  const run = JSON.parse(await readFile(inPath, "utf8")) as JudgeRun
  const answers = await loadAnswers(answersPath)
  const outPath = resolve(
    process.cwd(),
    flag(argv, "out") ?? `prototype-runs/chat-eval/report-${run.mode}.md`,
  )

  // Never render a judgement file against answers it did not come from.
  if (answers) {
    const problems = identityMismatch(run.identity, answers.identity)
    if (problems.length > 0) {
      throw new Error(
        `judgement and answer files disagree on: ${problems.join(", ")} — refusing to pair them`,
      )
    }
  }

  const models = run.identity.answeringModels
  const errors = run.judged.filter((entry) => entry.errors.length > 0)

  // Quote fidelity: how often did the judge produce evidence that isn't there?
  const allVerdicts = run.judged.flatMap((entry) => entry.verdicts ?? [])
  const quoted = allVerdicts.filter((verdict) => verdict.quote != null)
  const fabricated = quoted.filter(
    (verdict) => verdict.quoteFidelity === "absent",
  )
  const retyped = quoted.filter(
    (verdict) => verdict.quoteFidelity === "normalised",
  )

  const sections: string[] = [
    `# chat-eval prototype — ${run.mode}`,
    "",
    "| | |",
    "| --- | --- |",
    `| prompt | \`${run.identity.promptId}\` (\`${run.identity.promptSha256.slice(0, 12)}\`) |`,
    `| questions | \`${run.identity.questionSetId}\` |`,
    `| judge | \`${run.judgeModel}\` |`,
    `| finished | ${run.finishedAt} |`,
    "",
    "> Bands, not decimals. A single sample per cell cannot support a ranking.",
    "",
    "## Grid",
    "",
    gridTable(run.judged, models),
    "",
    "## By category",
    "",
    categoryRollup(run.judged),
    "",
  ]

  if (quoted.length > 0) {
    sections.push(
      "## Quote fidelity",
      "",
      "Does the judge's evidence actually appear in the answer? A fabricated",
      "quote is the failure the quote requirement exists to prevent.",
      "",
      `- quotes returned: **${quoted.length}**`,
      `- verbatim: **${quoted.length - fabricated.length - retyped.length}**`,
      `- retyped (matched only after normalising): **${retyped.length}**`,
      `- **fabricated (not in the answer at all): ${fabricated.length}**`,
      "",
    )
    for (const verdict of fabricated.slice(0, 10)) {
      sections.push(
        `- \`${verdict.criterionId}\` — “${verdict.quote?.slice(0, 120)}”`,
      )
    }
    if (fabricated.length > 0) sections.push("")
  }

  sections.push("## Errors (not counted as failures)", "")
  if (errors.length === 0) {
    sections.push("None.", "")
  } else {
    for (const entry of errors) {
      sections.push(
        `- \`${entry.questionId}\` x \`${shortModel(entry.model)}\` — ${entry.errors.join("; ")}`,
      )
    }
    sections.push("")
  }

  sections.push("## Detail", "")
  for (const entry of run.judged) {
    sections.push(
      `### \`${entry.questionId}\` x \`${shortModel(entry.model)}\` — ${entry.band}`,
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
      sections.push("| criterion | verdict | quote |", "| --- | --- | --- |")
      for (const verdict of entry.verdicts) {
        const quote = verdict.quote
          ? `“${verdict.quote.replace(/\|/g, "\\|").slice(0, 160)}”`
          : "—"
        sections.push(
          `| \`${verdict.criterionId}\` | ${verdict.verdict} | ${quote} |`,
        )
      }
      sections.push("")
    }
    if (entry.dimensions) {
      const scores = Object.entries(entry.dimensions.scores)
        .map(([key, value]) => `${key} ${value.toFixed(2)}`)
        .join(" · ")
      sections.push(scores, "")
      for (const reason of entry.dimensions.reasons) {
        sections.push(`- ${reason}`)
      }
      sections.push("")
    }
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${sections.join("\n")}\n`, "utf8")

  console.log(gridTable(run.judged, models))
  console.log("")
  console.log(`wrote ${outPath}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
