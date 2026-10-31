import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { RecommendationInputError } from "../services/recommendations/errors"
import {
  convertLegacyCandidateTraces,
  freezeConversionManifest,
  type ConversionManifest,
} from "../services/recommendations/legacy-candidate-trace-conversion.service"

const Holds = z
  .object({
    qualitySelectorSha256: z.string().regex(/^[a-f0-9]{64}$/),
    qualityRunIds: z.array(z.string().min(1).max(191)).length(64),
    activeInvestigationRunIds: z.array(z.string().min(1).max(191)).max(10_000),
  })
  .strip()

export function parseConversionArguments(argv: string[]) {
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
        "--manifest",
        "--freeze",
        "--holds",
        "--run-ids",
        "--created-before",
        "--max-bytes",
        "--confirm-target",
      ]).has(key) ||
      values.has(key) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith("--")
    ) {
      throw new RecommendationInputError(
        "Unknown, duplicate or incomplete conversion option",
      )
    }
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
    ) {
      throw new RecommendationInputError(
        "Freeze requires reviewed holds, run IDs and an older cutoff; no execution",
      )
    }
  } else if (
    !values.has("--manifest") ||
    ["--holds", "--run-ids", "--created-before", "--max-bytes"].some((key) =>
      values.has(key),
    ) ||
    (execute && !values.has("--confirm-target")) ||
    (!execute && values.has("--confirm-target"))
  ) {
    throw new RecommendationInputError(
      "Use --manifest for dry run; execution also requires --confirm-target",
    )
  }
  const maxBytes = values.has("--max-bytes")
    ? Number(values.get("--max-bytes"))
    : undefined
  if (
    maxBytes !== undefined &&
    (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024)
  ) {
    throw new RecommendationInputError(
      "Encoded-byte budget must be between 1 and 16777216",
    )
  }
  return { execute, values, maxBytes }
}

async function main() {
  const args = parseConversionArguments(process.argv.slice(2))
  // Lazy import keeps argument-only tests independent of env/client initialization.
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
      const manifest = await freezeConversionManifest(db, {
        holds,
        runIds,
        createdBefore: args.values.get("--created-before")!,
        maxEncodedBytes: args.maxBytes,
      })
      // Never overwrite an existing frozen manifest or expose IDs in console logs.
      writeFileSync(
        args.values.get("--freeze")!,
        JSON.stringify(manifest, null, 2) + "\n",
        { mode: 0o600, flag: "wx" },
      )
      console.log(
        JSON.stringify({
          status: "frozen",
          targetDatabaseHash: manifest.targetDatabaseHash,
          manifestDigest: manifest.digest,
          runs: manifest.candidates.length,
          rows: manifest.candidates.reduce((n, c) => n + c.rows, 0),
          bytes: manifest.candidates.reduce((n, c) => n + c.bytes, 0),
        }),
      )
    } else {
      const manifest: ConversionManifest = JSON.parse(
        readFileSync(args.values.get("--manifest")!, "utf8"),
      )
      const result = await convertLegacyCandidateTraces(db, manifest, {
        execute: args.execute,
        confirmTarget: args.values.get("--confirm-target"),
      })
      console.log(JSON.stringify(result))
    }
  } finally {
    await db.$disconnect()
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "Legacy trace conversion stopped; inspect the private manifest and database budgets. No credentials or evidence logged.",
    )
    process.exitCode = 1
  })
}
