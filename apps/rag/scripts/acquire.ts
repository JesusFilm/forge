import { acquireSource } from "../src/acquisition/index.js"
import { allSources, getSource } from "../src/registry/index.js"
import { parseAcquireArgs } from "./lib/maintenance-args.js"
import { installProductionEnvironment } from "./lib/production-target.js"

async function main() {
  const argv = process.argv.slice(2)
  const production = argv.includes("--production")
  const args = parseAcquireArgs(argv)
  if (production) installProductionEnvironment(process.env, args.apply)
  const entries = args.all ? allSources() : [getSource(args.source as string)]
  if (entries.some((entry) => !entry))
    throw new Error(`unknown source '${args.source}'`)
  const { wire } = await import("../src/main.js")
  const wiring = wire()
  try {
    for (const entry of entries) {
      if (!entry) continue
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
    }
  } finally {
    await wiring.shutdown()
  }
}

main().catch((error) => {
  console.error(`acquire failed: ${(error as Error).message}`)
  process.exitCode = 1
})
