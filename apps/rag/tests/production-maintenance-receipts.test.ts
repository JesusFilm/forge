import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  shutdown: vi.fn().mockResolvedValue(undefined),
  listPending: vi.fn().mockResolvedValue([]),
  acquireSource: vi
    .fn()
    .mockResolvedValue({ resolved: 51, attempted: 0, written: 0 }),
  ingestPending: vi.fn().mockResolvedValue({ attempted: 0, failed: 0 }),
  wire: vi.fn(),
}))

vi.mock("../src/main.js", () => ({ wire: runtime.wire }))
vi.mock("../src/acquisition/index.js", () => ({
  acquireSource: runtime.acquireSource,
}))
vi.mock("../src/indexing/index.js", () => ({
  ingestPending: runtime.ingestPending,
}))

const originalArgv = process.argv
const originalExitCode = process.exitCode

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv(
    "FORGE_RAG_POSTGRESQL_READONLY_DB_URL",
    "postgresql://forge_rag_evaluator:reader-secret@forge.example/rag",
  )
  vi.stubEnv(
    "FORGE_RAG_POSTGRESQL_DB_URL",
    "postgresql://owner:writer-secret@forge.example/rag",
  )
  vi.stubEnv("FORGE_RAG_EXPECTED_POSTGRES_HOST", "forge.example")
  vi.stubEnv("FORGE_RAG_ALLOW_PROD_WRITE", "1")
  vi.stubEnv("OPENROUTER_API_KEY", "provider-secret")
  // Track the fields installed by the production boundary for test cleanup too.
  vi.stubEnv("DATABASE_URL", "postgresql://local:p@localhost/local")
  vi.stubEnv("EMBED_MODEL_ID", "local/model")
  runtime.listPending.mockResolvedValue([])
  runtime.wire.mockImplementation(() => ({
    fetcherFor: vi.fn(),
    rawDocumentStore: {},
    rawDocumentReader: { listPending: runtime.listPending },
    corpusWriteStore: {},
    embedder: { model: "forge/model" },
    shutdown: runtime.shutdown,
  }))
})

afterEach(() => {
  process.argv = originalArgv
  process.exitCode = originalExitCode
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function run(command: "acquire" | "index", flags: string[]) {
  process.argv = [
    "node",
    command,
    "--production",
    "--source",
    "gotquestions",
    "--path-prefix",
    "/islenska/",
    ...flags,
  ]
  if (command === "acquire") await import("../scripts/acquire.js")
  else await import("../scripts/index.js")
  await vi.waitFor(() => expect(runtime.shutdown).toHaveBeenCalledOnce())
}

describe.each(["acquire", "index"] as const)(
  "%s production receipts",
  (command) => {
    it.each([false, true])(
      "identifies the selected Forge target, scope and bounds for apply=%s",
      async (apply) => {
        await run(command, [
          ...(apply ? ["--apply"] : []),
          ...(command === "index" ? ["--limit", "51"] : ["--resume"]),
        ])
        expect(console.error).not.toHaveBeenCalled()
        expect(process.env.DATABASE_URL).toContain(
          apply
            ? "owner:writer-secret@forge.example"
            : "forge_rag_evaluator:reader-secret@forge.example",
        )
        const receipts = vi
          .mocked(console.log)
          .mock.calls.map(([line]) => JSON.parse(String(line)))
        expect(receipts).toHaveLength(2)
        for (const receipt of receipts) {
          expect(receipt).toMatchObject({
            target: "forge",
            mode: apply ? "apply" : "preview",
            databaseHost: "forge.example",
            databaseName: "rag",
            source: "gotquestions",
            pathPrefix: "/islenska/",
            canonicalUrlPrefix: "https://www.gotquestions.org/islenska/",
            dryRun: !apply,
            ...(command === "index"
              ? { limit: 51, concurrency: 4 }
              : { maxPages: 51, resume: true }),
          })
          expect(JSON.stringify(receipt)).not.toMatch(/secret|owner|evaluator/)
        }
        expect(receipts.map(({ event }) => event)).toEqual([
          `${command}-start`,
          `${command}-complete`,
        ])
        if (command === "acquire") {
          expect(runtime.acquireSource).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ key: "gotquestions" }),
            expect.objectContaining({ dryRun: !apply, resume: true }),
          )
        } else if (apply) {
          expect(runtime.ingestPending).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
              sourceKey: "gotquestions",
              canonicalUrlPrefix: "https://www.gotquestions.org/islenska/",
              limit: 51,
            }),
          )
          expect(runtime.listPending).not.toHaveBeenCalled()
        } else {
          expect(runtime.listPending).toHaveBeenCalledWith(
            expect.objectContaining({
              sourceKey: "gotquestions",
              canonicalUrlPrefix: "https://www.gotquestions.org/islenska/",
              limit: 51,
            }),
          )
          expect(runtime.ingestPending).not.toHaveBeenCalled()
        }
      },
    )
  },
)

it.each([
  {
    id: "outside-source",
    sourceKey: "cru",
    canonicalUrl: "https://www.gotquestions.org/islenska/one.html",
  },
  {
    id: "outside-path",
    sourceKey: "gotquestions",
    canonicalUrl: "https://www.gotquestions.org/english.html",
  },
])(
  "refuses index preview rows outside the requested scope ($id)",
  async (row) => {
    runtime.listPending.mockResolvedValue([row])
    await run("index", ["--limit", "51"])
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "index failed: index reader returned rows outside the requested scope",
      ),
    )
    expect(runtime.ingestPending).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledTimes(1)
  },
)
