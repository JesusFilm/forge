#!/usr/bin/env tsx
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { csv, flag } from "../cli"
import { TerminalVerdictSchema } from "./types"
import { recordTerminalVerdict, type TerminalVerdictResult } from "./verdict"

export function verdictCommandArgs(argv: readonly string[]) {
  const required = (name: string): string => {
    const value = flag(argv, name)?.trim()
    if (!value) throw new Error(`--${name}=<value> is required`)
    return value
  }
  const evidence = csv(required("evidence"))
  if (evidence.length === 0)
    throw new Error("--evidence requires at least one path")
  return {
    experimentDir: required("experiment"),
    attemptId: required("attempt"),
    candidateId: required("candidate"),
    verdict: TerminalVerdictSchema.parse(required("verdict")),
    actor: required("actor"),
    reasoning: required("reason"),
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

export async function main(argv = process.argv.slice(2)): Promise<void> {
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
