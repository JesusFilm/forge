import { acquireSource } from "../src/acquisition/index.js"
import {
  acquirableSources,
  acquisitionDisabledReason,
  disabledAcquisitionSources,
  getSource,
} from "../src/registry/index.js"
import { RagOperationalError } from "../src/contracts/index.js"
import { parseAcquireArgs } from "./lib/maintenance-args.js"
import { installProductionEnvironment } from "./lib/production-target.js"

async function main() {
  const argv = process.argv.slice(2)
  const production = argv.includes("--production")
  const args = parseAcquireArgs(argv)
  if (production) installProductionEnvironment(process.env, args.apply)
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
    for (const entry of entries) {
      if (!entry) continue
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
        console.log(JSON.stringify(result))
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
