#!/usr/bin/env tsx
/**
 * Seeker eval — STEP 0. Capture real RAG results as fixtures.
 *
 * Runs every question against a live JesusFilm RAG and records exactly what
 * `retrieveAnswer` would have handed the model. The recording is committed,
 * so later runs are reproducible without the RAG being up — and, critically,
 * so a score change between two runs cannot be silently caused by the corpus
 * moving underneath them.
 *
 * The fixture file carries a `corpusSha256` over every passage returned. Two
 * runs with different fingerprints are not comparable.
 *
 *   RAG_BASE_URL=http://localhost:8080 RAG_API_KEY=... \
 *     pnpm --filter @forge/mastra eval:seeker:capture-rag
 */
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { loadEnvFiles } from "./env"
import { QUESTIONS } from "./questions"
import {
  RAG_TOP_K,
  searchRag,
  type RagFixture,
  type RagFixtureFile,
} from "./rag"

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUT = resolve(MODULE_DIR, "fixtures/rag-fixtures.json")

function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

/** Fingerprint every passage, so a re-index is visible as a changed hash.
 *  KNOWN LIMITATION (accepted): the material hashes `text.length` — not the
 *  text CONTENT — and omits `title`, so a same-length passage rewrite or a
 *  title-only change is invisible. Changing the material invalidates the
 *  committed corpusSha256 pin, the baseline, and every stamped run identity,
 *  so it requires a deliberate re-capture, never a drive-by edit. */
export function corpusHash(fixtures: readonly RagFixture[]): string {
  const material = fixtures
    .map((fixture) =>
      [
        fixture.questionId,
        fixture.result.status,
        ...fixture.result.sources.map(
          (source) =>
            `${source.url}|${source.sourceName}|${source.text.length}`,
        ),
      ].join("\n"),
    )
    .join("\n")
  return createHash("sha256").update(material).digest("hex")
}

async function main(): Promise<void> {
  loadEnvFiles()
  const argv = process.argv.slice(2)

  const baseUrl =
    flag(argv, "base-url") ??
    process.env.RAG_BASE_URL ??
    "http://localhost:8080"
  const apiKey = flag(argv, "api-key") ?? process.env.RAG_API_KEY
  if (!apiKey) {
    throw new Error(
      [
        "RAG_API_KEY is not set. The local RAG requires a bearer token.",
        "",
        "For the docker-compose stack, the serve container holds it:",
        "  export RAG_API_KEY=$(docker inspect jesusfilm-rag-serve \\",
        "    --format '{{range .Config.Env}}{{println .}}{{end}}' \\",
        "    | grep '^SERVE_BEARER_TOKENS=' | cut -d= -f2- \\",
        "    | python3 -c 'import json,sys; print(list(json.load(sys.stdin))[0])')",
      ].join("\n"),
    )
  }

  const topK = Number(flag(argv, "top-k") ?? RAG_TOP_K)
  const outPath = resolve(process.cwd(), flag(argv, "out") ?? DEFAULT_OUT)

  console.log(`rag      : ${baseUrl}`)
  console.log(`questions: ${QUESTIONS.length}`)
  console.log(`topK     : ${topK}`)
  console.log("")

  const fixtures: RagFixture[] = []
  for (const question of QUESTIONS) {
    process.stdout.write(`  ${question.id} ... `)
    const result = await searchRag({
      query: question.text,
      baseUrl,
      apiKey,
      topK,
    })
    fixtures.push({
      questionId: question.id,
      query: question.text,
      capturedAt: new Date().toISOString(),
      result,
    })
    const names = [
      ...new Set(result.sources.map((source) => source.sourceName)),
    ]
    console.log(
      `${result.status} — ${result.sources.length} passages${
        names.length > 0 ? ` (${names.join(", ")})` : ""
      }`,
    )
  }

  const file: RagFixtureFile = {
    kind: "chat-eval-rag-fixtures",
    capturedAt: new Date().toISOString(),
    baseUrl,
    topK,
    corpusSha256: corpusHash(fixtures),
    fixtures,
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf8")

  const unavailable = fixtures.filter(
    (fixture) => fixture.result.status === "unavailable",
  ).length
  console.log("")
  console.log(`wrote ${outPath}`)
  console.log(`corpus ${file.corpusSha256.slice(0, 16)}`)
  if (unavailable > 0) {
    // A capture with dead cells must not become a fixture set someone runs
    // against — that is a retrieval outage masquerading as a prompt result.
    throw new Error(
      `${unavailable} question(s) returned "unavailable" — fix the RAG and re-capture`,
    )
  }
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
