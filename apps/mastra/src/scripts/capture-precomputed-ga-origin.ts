import { readFile, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"

import { z } from "zod"

import {
  CatalogGenerationInputSchema,
  runPrecomputedCatalog,
} from "../services/precomputed-recommendations/catalog-generation"

class GaOriginCommandError extends Error {
  readonly code = "manual_ga_origin_config_invalid"
}

const configSchema = z
  .object({
    input: CatalogGenerationInputSchema.pick({
      generationId: true,
      inputCutoff: true,
      capacity: true,
    }).strict(),
    stagingDirectory: z.string().min(1).refine(isAbsolute),
  })
  .strict()

async function main(args: string[]) {
  if (
    args.length !== 3 ||
    args[0] !== "--config" ||
    !isAbsolute(args[1] ?? "") ||
    args[2] !== "--execute" ||
    process.env.CI ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_ENVIRONMENT_NAME ||
    process.env.RAILWAY_SERVICE_ID
  )
    throw new GaOriginCommandError()
  const path = args[1]!
  const file = await stat(path)
  if (!file.isFile() || file.size > 16_384) throw new GaOriginCommandError()
  const config = configSchema.parse(
    JSON.parse(await readFile(path, "utf8")) as unknown,
  )
  if (!(await stat(config.stagingDirectory)).isDirectory())
    throw new GaOriginCommandError()
  const result = await runPrecomputedCatalog(
    {
      ...config.input,
      historyRequired: true,
      snapshotMode: "ga_aggregate_capture_v1",
      captureOnly: true,
    },
    { gaCaptureDirectory: config.stagingDirectory },
  )
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.gaOriginReady) process.exitCode = 1
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "manual_ga_origin_failed"
  process.stderr.write(`GA origin capture stopped: ${code}\n`)
  process.exitCode = 1
})
