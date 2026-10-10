#!/usr/bin/env tsx
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { csv, flag } from "../cli"
import { ResolvedIdentitySchema, TerminalVerdictSchema } from "./types"
import { preparePromotion, type PromotionResult } from "./promotion"
import { recordTerminalVerdict, type TerminalVerdictResult } from "./verdict"

function requiredFlag(argv: readonly string[], name: string): string {
  const value = flag(argv, name)?.trim()
  if (!value) throw new Error(`--${name}=<value> is required`)
  return value
}

export function verdictCommandArgs(argv: readonly string[]) {
  const evidence = csv(requiredFlag(argv, "evidence"))
  if (evidence.length === 0)
    throw new Error("--evidence requires at least one path")
  return {
    experimentDir: requiredFlag(argv, "experiment"),
    attemptId: requiredFlag(argv, "attempt"),
    candidateId: requiredFlag(argv, "candidate"),
    verdict: TerminalVerdictSchema.parse(requiredFlag(argv, "verdict")),
    actor: requiredFlag(argv, "actor"),
    reasoning: requiredFlag(argv, "reason"),
    evidence,
    experimentsRoot: flag(argv, "experiments-root")?.trim(),
  }
}

export async function executeVerdictCommand(
  argv: readonly string[],
  cwd = process.cwd(),
  recorder: typeof recordTerminalVerdict = recordTerminalVerdict,
): Promise<TerminalVerdictResult> {
  const args = verdictCommandArgs(argv)
  const experimentDir = resolve(cwd, args.experimentDir)
  const experimentsRoot = resolve(
    cwd,
    args.experimentsRoot ?? resolve(experimentDir, ".."),
  )
  return recorder({
    experimentsRoot,
    experimentDir,
    attemptId: args.attemptId,
    candidateId: args.candidateId,
    verdict: args.verdict,
    actor: args.actor,
    reasoning: args.reasoning,
    evidence: args.evidence,
  })
}

export function promotionCommandArgs(argv: readonly string[]) {
  return {
    experimentPath: requiredFlag(argv, "experiment"),
    attemptId: requiredFlag(argv, "attempt"),
    candidateId: requiredFlag(argv, "candidate"),
    evidenceCommit: requiredFlag(argv, "commit"),
    productionIdentityPath: requiredFlag(argv, "production-identity"),
    benchmarkDir: requiredFlag(argv, "benchmark-dir"),
    materialize: argv.includes("--materialize"),
  }
}

export async function executePromotionCommand(
  argv: readonly string[],
  cwd = process.cwd(),
  promoter: typeof preparePromotion = preparePromotion,
): Promise<PromotionResult> {
  const args = promotionCommandArgs(argv)
  const identity = ResolvedIdentitySchema.parse(
    JSON.parse(
      await readFile(resolve(cwd, args.productionIdentityPath), "utf8"),
    ),
  )
  return promoter({
    repositoryRoot: cwd,
    experimentPath: args.experimentPath,
    attemptId: args.attemptId,
    candidateId: args.candidateId,
    evidenceCommit: args.evidenceCommit,
    proposedIdentity: identity,
    benchmarkDir: args.benchmarkDir,
    materialize: args.materialize,
  })
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "promote") {
    const result = await executePromotionCommand(argv.slice(1))
    console.log(
      result.valid
        ? `promotion validated for ${result.source.experimentId}`
        : `promotion requires a fresh qualifying run: ${result.mismatches.join(", ")}`,
    )
    if (!result.valid) process.exitCode = 1
    return
  }
  const result = await executeVerdictCommand(argv)
  console.log(`recorded terminal verdict at ${result.path}`)
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
