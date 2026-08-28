import { ingestPending } from "../src/indexing/index.js"
import { parseIndexArgs } from "./lib/maintenance-args.js"
import { installProductionEnvironment } from "./lib/production-target.js"

async function main() {
  const argv = process.argv.slice(2)
  const production = argv.includes("--production")
  const args = parseIndexArgs(argv)
  if (production) installProductionEnvironment(process.env, args.apply)
  if (!args.apply) {
    console.log(
      `DRY RUN: would index ${args.source ?? "all sources"}; concurrency=${args.concurrency}; no staging or corpus rows changed`,
    )
    return
  }
  const { wire } = await import("../src/main.js")
  const wiring = wire()
  try {
    const summary = await ingestPending(
      {
        reader: wiring.rawDocumentReader,
        embedder: wiring.embedder,
        writer: wiring.corpusWriteStore,
      },
      {
        sourceKey: args.source,
        limit: args.limit,
        concurrency: args.concurrency,
        force: args.force,
        forceAll: args.forceAll,
        onProgress: console.log,
      },
    )
    console.log(
      JSON.stringify({ ...summary, embeddingModel: wiring.embedder.model }),
    )
  } finally {
    await wiring.shutdown()
  }
}

main().catch((error) => {
  console.error(`index failed: ${(error as Error).message}`)
  process.exitCode = 1
})
