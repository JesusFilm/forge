import { fileURLToPath } from "node:url"

import type { RetrievalPolicy } from "@forge/rag-contracts"

import { loadEnvironmentFiles } from "../src/config/env.js"
import { wire } from "../src/main.js"

function parse(argv: string[]): { query: string; policy: RetrievalPolicy } {
  const policy: RetrievalPolicy = {}
  const free: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const value = (): string => {
      const next = argv[++index]
      if (!next) throw new Error(`${arg} needs a value`)
      return next
    }
    if (arg === "--top-k") {
      const parsed = Number(value())
      if (!Number.isInteger(parsed) || parsed <= 0)
        throw new Error("--top-k must be a positive integer")
      policy.topK = parsed
    } else if (arg === "--min-score") {
      const parsed = Number(value())
      if (!Number.isFinite(parsed))
        throw new Error("--min-score must be a number")
      policy.minScore = parsed
    } else if (arg === "--source") policy.allowedSourceKeys = [value()]
    else if (arg === "--prefer") policy.preferSourceKey = value()
    else if (arg === "--language") policy.language = value()
    else if (arg === "--category") policy.category = value()
    else free.push(arg)
  }
  return { query: free.join(" ").trim(), policy }
}

type QueryDependencies = {
  packageDirectory?: string
  environment?: NodeJS.ProcessEnv
  createWiring?: typeof wire
  log?: (message: string) => void
}

export async function runQuery(
  argv: string[],
  dependencies: QueryDependencies = {},
): Promise<void> {
  const { query, policy } = parse(argv)
  if (!query) throw new Error('usage: pnpm query [filters] "question"')

  const packageDirectory =
    dependencies.packageDirectory ??
    fileURLToPath(new URL("..", import.meta.url))
  const environment = loadEnvironmentFiles(
    packageDirectory,
    dependencies.environment,
  )
  const wiring = (dependencies.createWiring ?? wire)(environment)
  const log = dependencies.log ?? console.log
  try {
    const hits = await wiring.retriever.search(query, policy)
    for (const [index, hit] of hits.entries()) {
      const snippet = hit.text.replace(/\s+/g, " ").trim().slice(0, 240)
      log(
        `${index + 1}. [${hit.score.toFixed(3)}] ${hit.citation.title ?? "(untitled)"} — ${hit.citation.sourceName}\n   ${hit.citation.url}\n   ${snippet}`,
      )
    }
    if (hits.length === 0) log("No hits above the score cutoff")
  } finally {
    await wiring.shutdown()
  }
}

const invokedPath = process.argv[1]
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await runQuery(process.argv.slice(2))
}
