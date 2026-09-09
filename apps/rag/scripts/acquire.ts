import { canonicalPrefix, scopeSource } from "./lib/path-scope.js"
import { acquireSource } from "../src/acquisition/index.js"
import {
  acquirableSources,
  acquisitionDisabledReason,
  disabledAcquisitionSources,
  getSource,
} from "../src/registry/index.js"
import { RagOperationalError } from "../src/contracts/index.js"
import { parseAcquireArgs } from "./lib/maintenance-args.js"
import { installForgeProductionEnvironment } from "./lib/production-target.js"

async function main() {
  const argv = process.argv.slice(process.argv[2] === "--" ? 3 : 2)
  const production = argv.includes("--production")
  const args = parseAcquireArgs(argv)
  const entries = args.all
    ? acquirableSources()
    : [getSource(args.source as string)]
  if (entries.some((entry) => !entry))
    throw new RagOperationalError(
      "argument_invalid",
      `unknown source '${args.source}'`,
    )
  if (!args.all && entries[0]) {
    const reason = acquisitionDisabledReason(entries[0])
    if (reason)
      throw new RagOperationalError(
        "acquisition_source_disabled",
        `source '${entries[0].key}' is not acquirable: ${reason}`,
      )
  }
  // Resolve every registered slice before environment mutation or runtime wiring.
  const scopedEntries = entries.flatMap((entry) =>
    entry ? [scopeSource(entry, args.pathPrefix)] : [],
  )
  const target = production
    ? installForgeProductionEnvironment(process.env, args.apply)
    : { target: "local", mode: args.apply ? "apply" : "preview" }
  if (args.all)
    for (const entry of disabledAcquisitionSources())
      console.log(
        JSON.stringify({
          source: entry.key,
          skipped: "acquisition-disabled",
          reason: acquisitionDisabledReason(entry),
        }),
      )
  const { wire } = await import("../src/main.js")
  const wiring = wire()
  try {
    const failures: Error[] = []
    for (const entry of scopedEntries) {
      const operation = {
        ...target,
        source: entry.key,
        pathPrefix: args.pathPrefix ?? null,
        canonicalUrlPrefix: canonicalPrefix(entry, args.pathPrefix) ?? null,
        maxPages: entry.crawl.maxPages,
        resume: args.resume,
        dryRun: args.dryRun,
      }
      console.log(JSON.stringify({ event: "acquire-start", ...operation }))
      try {
        const result = await acquireSource(
          { fetcher: wiring.fetcherFor(entry), store: wiring.rawDocumentStore },
          entry,
          {
            dryRun: args.dryRun,
            resume: args.resume,
            onProgress: console.log,
          },
        )
        console.log(
          JSON.stringify({
            event: "acquire-complete",
            ...result,
            ...operation,
          }),
        )
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error))
        if (!args.all) throw failure
        failures.push(new Error(`${entry.key}: ${failure.message}`))
        console.error(`  ⤫ ${entry.key} — ${failure.message}`)
      }
    }
    if (failures.length)
      throw new AggregateError(
        failures,
        `${failures.length} source acquisition(s) failed`,
      )
  } finally {
    await wiring.shutdown()
  }
}

main().catch((error) => {
  console.error(`acquire failed: ${(error as Error).message}`)
  process.exitCode = 1
})
