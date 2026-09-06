import { readFile } from "node:fs/promises"

import YAML from "yaml"

import {
  compareReceipts,
  lossDispositionSchema,
  type LossDisposition,
} from "./lib/evaluation/identity.js"

async function main(argv: string[]): Promise<void> {
  if (argv.length < 2 || argv.length > 3)
    throw new Error(
      "usage: eval:compare CONTROL.json CANDIDATE.json [dispositions.yaml]",
    )
  const [controlPath, candidatePath, dispositionPath] = argv
  const [control, candidate] = await Promise.all([
    readFile(controlPath, "utf8").then(JSON.parse),
    readFile(candidatePath, "utf8").then(JSON.parse),
  ])
  let dispositions: Record<string, LossDisposition> = {}
  if (dispositionPath) {
    const raw = YAML.parse(await readFile(dispositionPath, "utf8")) as unknown
    const parsed = Object.entries((raw ?? {}) as Record<string, unknown>).map(
      ([id, value]) => [id, lossDispositionSchema.parse(value)] as const,
    )
    dispositions = Object.fromEntries(parsed)
  }
  const comparison = compareReceipts(control, candidate, dispositions)
  console.log(JSON.stringify(comparison, null, 2))
  if (comparison.state !== "pass") process.exitCode = 1
}

await main(process.argv.slice(2))
