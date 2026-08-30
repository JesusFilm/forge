import { ingestPending } from "../src/indexing/index.js"
import { parseIndexArgs } from "./lib/maintenance-args.js"
import { installProductionEnvironment } from "./lib/production-target.js"
import { getSource } from "../src/registry/index.js"
import { RagOperationalError } from "../src/contracts/index.js"

async function main() {
  const argv = process.argv.slice(2)
  const production = argv.includes("--production")
  const args = parseIndexArgs(argv)
  if (production) installProductionEnvironment(process.env, args.apply)
  if (args.source && !getSource(args.source))
    throw new RagOperationalError(
      "argument_invalid",
      `unknown source '${args.source}'`,
    )
  const { wire } = await import("../src/main.js")
  const wiring = wire()
  try {
    if (!args.apply) {
      const candidates = await wiring.rawDocumentReader.listPending({
        sourceKey: args.source,
        limit: args.limit,
        includeIngested: args.force,
        targetEmbeddingModel:
          args.force && !args.forceAll ? wiring.embedder.model : undefined,
      })
      console.log(
        JSON.stringify({
          dryRun: true,
          source: args.source ?? "all",
          candidateCount: candidates.length,
          candidateIds: candidates.map(({ id }) => id),
          embeddingModel: wiring.embedder.model,
          mutation: false,
        }),
      )
      return
    }
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
