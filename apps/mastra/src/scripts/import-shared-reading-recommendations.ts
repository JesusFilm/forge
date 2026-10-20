import { readFile, writeFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import {
  prepareSharedReadingImport,
  sharedImportConfigSchema,
} from "../services/precomputed-recommendations/shared-reading-import"

/** Default is local read-only validation. Submission is an explicit operator action. */
export async function main(args = process.argv.slice(2)) {
  const flags = new Map<string, string>()
  let submit = false
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === "--submit") {
      submit = true
      continue
    }
    if (
      !["--config", "--export"].includes(flag) ||
      !args[index + 1] ||
      flags.has(flag)
    )
      throw new Error(
        "Use --config <absolute.json> [--export <new-private.json>] [--submit]",
      )
    flags.set(flag, args[++index])
  }
  const path = flags.get("--config")
  if (!path || !isAbsolute(path))
    throw new Error("An absolute config path is required")
  const config = sharedImportConfigSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  )
  const result = await prepareSharedReadingImport(config)
  const output = flags.get("--export")
  if (output) {
    if (!isAbsolute(output)) throw new Error("Export path must be absolute")
    for (const directory of result.inspectedRunDirectories) {
      const rel = relative(resolve(directory, ".."), resolve(output))
      if (!rel.startsWith("..") && !isAbsolute(rel))
        throw new Error("Export must be outside inspected runs")
    }
    await writeFile(output, JSON.stringify(result), { flag: "wx", mode: 0o600 })
  }
  if (submit) {
    const url = process.env.ADMIN_RECOMMENDATION_INGEST_URL
    const key = process.env.ADMIN_MASTRA_RECOMMENDATION_API_KEY
    if (!url || !key || new URL(url).protocol !== "https:")
      throw new Error(
        "Explicit HTTPS ingest URL and existing operator bearer required",
      )
    for (const body of result.submissions) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      })
      if (!response.ok)
        throw new Error(
          `Private import stopped at ${body.action}: HTTP ${response.status}; identical replay is permitted after investigation`,
        )
      const envelope = z
        .object({
          result: z
            .object({ state: z.enum(["incomplete", "complete"]) })
            .passthrough(),
        })
        .parse(await response.json())
      if (
        body.action === "shared_reading_complete" &&
        envelope.result.state !== "complete"
      )
        throw new Error(
          "Private import did not complete; no retry was dispatched",
        )
    }
  }
  console.log(
    JSON.stringify({
      ...result.summary,
      generationId: config.generationId,
      inputDigest: result.inputDigest,
      submitted: submit,
      exported: output ?? null,
    }),
  )
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Private import failed",
    )
    process.exitCode = 1
  })
}
