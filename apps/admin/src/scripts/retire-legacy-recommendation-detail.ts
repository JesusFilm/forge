import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { RecommendationInputError } from "../services/recommendations/errors"
import {
  freezeLegacyDetailRetirement,
  runLegacyDetailRetirement,
  type LegacyDetailRetirementManifest,
} from "../services/recommendations/legacy-detail-retirement.service"

const Holds = z
  .object({
    qualitySelectorSha256: z.string().regex(/^[a-f0-9]{64}$/),
    qualityRunIds: z.array(z.string().min(1).max(191)).length(64),
    activeInvestigationRunIds: z.array(z.string().min(1).max(191)).max(10_000),
  })
  .strip()

export function parseRetirementArguments(argv: string[]) {
  const values = new Map<string, string>()
  let execute = false
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === "--execute") {
      if (execute) throw new RecommendationInputError("Duplicate execute flag")
      execute = true
      continue
    }
    if (
      !new Set([
        "--freeze",
        "--holds",
        "--run-ids",
        "--created-before",
        "--manifest",
        "--confirm-target",
      ]).has(key) ||
      values.has(key) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith("--")
    )
      throw new RecommendationInputError(
        "Unknown, duplicate or incomplete option",
      )
    values.set(key, argv[++i])
  }
  if (values.has("--freeze")) {
    if (
      execute ||
      values.has("--manifest") ||
      values.has("--confirm-target") ||
      !values.has("--holds") ||
      !values.has("--run-ids") ||
      !values.has("--created-before")
    )
      throw new RecommendationInputError(
        "Freeze requires holds, run IDs and cutoff",
      )
  } else if (
    !values.has("--manifest") ||
    ["--holds", "--run-ids", "--created-before"].some((key) =>
      values.has(key),
    ) ||
    execute !== values.has("--confirm-target")
  )
    throw new RecommendationInputError(
      "Execution requires manifest and target confirmation",
    )
  return { values, execute }
}

async function main() {
  const args = parseRetirementArguments(process.argv.slice(2))
  const { createPrismaClient } = await import("../db/client")
  const db = createPrismaClient("main")
  try {
    if (args.values.has("--freeze")) {
      const holds = Holds.parse(
        JSON.parse(readFileSync(args.values.get("--holds")!, "utf8")),
      )
      const runIds = z
        .array(z.string().min(1).max(191))
        .min(1)
        .max(10)
        .parse(JSON.parse(readFileSync(args.values.get("--run-ids")!, "utf8")))
      const manifest = await freezeLegacyDetailRetirement(db, {
        holds,
        runIds,
        createdBefore: args.values.get("--created-before")!,
      })
      writeFileSync(
        args.values.get("--freeze")!,
        JSON.stringify(manifest, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
      )
      console.log(
        JSON.stringify({
          status: "frozen",
          digest: manifest.digest,
          targetDatabaseHash: manifest.targetDatabaseHash,
          converted: manifest.candidates.filter((c) => c.action !== "retire")
            .length,
          retired: manifest.candidates.filter((c) => c.action === "retire")
            .length,
        }),
      )
    } else {
      const manifest: LegacyDetailRetirementManifest = JSON.parse(
        readFileSync(args.values.get("--manifest")!, "utf8"),
      )
      const result = await runLegacyDetailRetirement(db, manifest, {
        execute: args.execute,
        confirmTarget: args.values.get("--confirm-target"),
      })
      console.log(JSON.stringify(result))
    }
  } finally {
    await db.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Legacy detail retirement stopped. No raw trace or private IDs were logged.",
    )
    process.exitCode = 1
  })
