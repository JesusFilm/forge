import { canonicalPrefix } from "./lib/path-scope.js"
import { ingestPending } from "../src/indexing/index.js"
import { parseIndexArgs } from "./lib/maintenance-args.js"
import { installForgeProductionEnvironment } from "./lib/production-target.js"
import { getSource } from "../src/registry/index.js"
import { RagOperationalError } from "../src/contracts/index.js"

async function main() {
  const argv = process.argv.slice(process.argv[2] === "--" ? 3 : 2)
  const production = argv.includes("--production")
  const args = parseIndexArgs(argv)
  const source = args.source ? getSource(args.source) : undefined
  if (args.source && !source)
    throw new RagOperationalError(
      "argument_invalid",
      `unknown source '${args.source}'`,
    )
  const canonicalUrlPrefix = source
    ? canonicalPrefix(source, args.pathPrefix)
    : undefined
  const target = production
    ? installForgeProductionEnvironment(process.env, args.apply)
    : { target: "local", mode: args.apply ? "apply" : "preview" }
  const operation = {
    ...target,
    source: args.source ?? "all",
    pathPrefix: args.pathPrefix ?? null,
    canonicalUrlPrefix: canonicalUrlPrefix ?? null,
    limit: args.limit ?? null,
    concurrency: args.concurrency,
    force: args.force,
    forceAll: args.forceAll,
    dryRun: !args.apply,
  }
  const { wire } = await import("../src/main.js")
  const wiring = wire()
  try {
    console.log(JSON.stringify({ event: "index-start", ...operation }))
    if (!args.apply) {
      const candidates = await wiring.rawDocumentReader.listPending({
        sourceKey: args.source,
        canonicalUrlPrefix,
        limit: args.limit,
        includeIngested: args.force,
        targetEmbeddingModel:
          args.force && !args.forceAll ? wiring.embedder.model : undefined,
      })
      if (
        candidates.some(
          (raw) =>
            (args.source && raw.sourceKey !== args.source) ||
            (canonicalUrlPrefix &&
              !raw.canonicalUrl.startsWith(canonicalUrlPrefix)),
        )
      )
        throw new RagOperationalError(
          "argument_invalid",
          "index reader returned rows outside the requested scope",
        )
      console.log(
        JSON.stringify({
          event: "index-complete",
          ...operation,
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
        canonicalUrlPrefix,
        limit: args.limit,
        concurrency: args.concurrency,
        force: args.force,
        forceAll: args.forceAll,
        onProgress: console.log,
      },
    )
    console.log(
      JSON.stringify({
        event: "index-complete",
        ...summary,
        ...operation,
        embeddingModel: wiring.embedder.model,
      }),
    )
  } finally {
    await wiring.shutdown()
  }
}

main().catch((error) => {
  console.error(`index failed: ${(error as Error).message}`)
  process.exitCode = 1
})
