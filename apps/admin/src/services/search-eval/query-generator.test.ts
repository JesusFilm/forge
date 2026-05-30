import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  QueryGeneratorError,
  createQueryGenerator,
  createSyntheticQueryLoader,
} from "./query-generator"
import type { QueryGenerator } from "./query-generator"

function buildOpenRouterResponse(queries: string[], status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { content: JSON.stringify({ queries }) },
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 100 },
    }),
    { status, headers: { "content-type": "application/json" } },
  )
}

describe("createQueryGenerator", () => {
  it("returns the queries from a successful response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(buildOpenRouterResponse(["hope", "forgiveness"]))
    const gen = createQueryGenerator({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const queries = await gen.generateQueries("en", 2)
    expect(queries).toEqual(["hope", "forgiveness"])
  })

  it("trims and dedupes whitespace-equivalent entries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(buildOpenRouterResponse(["hope", "  hope  ", "faith"]))
    const gen = createQueryGenerator({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(await gen.generateQueries("en")).toEqual(["hope", "faith"])
  })

  it("rejects construction without an API key", () => {
    expect(() => createQueryGenerator({ apiKey: undefined })).toThrowError(
      QueryGeneratorError,
    )
  })

  it("throws validation when response shape is wrong", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"unexpected":true}' } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    const gen = createQueryGenerator({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(gen.generateQueries("en")).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("throws request_failed on non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 502 }))
    const gen = createQueryGenerator({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(gen.generateQueries("en")).rejects.toMatchObject({
      code: "request_failed",
    })
  })

  it("forwards the locale into the user prompt", async () => {
    let capturedBody: string | undefined
    const fetchImpl = vi.fn(async (_url, init) => {
      capturedBody = (init as { body?: string }).body
      return buildOpenRouterResponse(["aa", "bb"])
    })
    const gen = createQueryGenerator({
      apiKey: "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await gen.generateQueries("fr", 2)
    // body is JSON-encoded so quotes around "fr" are escaped as \"fr\"
    expect(capturedBody).toContain('\\"fr\\"')
  })
})

describe("createSyntheticQueryLoader", () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "query-loader-test-"))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  function buildLoader(generator: QueryGenerator) {
    return createSyntheticQueryLoader({
      directory: tmp,
      generator,
      modelLabel: "test-model",
      now: () => new Date("2026-05-07T00:00:00Z"),
    })
  }

  function fakeGenerator(queries: string[]): QueryGenerator {
    return {
      model: "fake-model",
      generateQueries: vi.fn().mockResolvedValue(queries),
    }
  }

  it("generates and writes when no cache exists", async () => {
    const gen = fakeGenerator(["hope", "faith"])
    const loader = buildLoader(gen)

    const out = await loader.loadOrGenerate("en", 2)
    expect(out).toEqual([
      { locale: "en", query: "hope", source: "synthetic" },
      { locale: "en", query: "faith", source: "synthetic" },
    ])

    const written = JSON.parse(
      await readFile(path.join(tmp, "en.json"), "utf8"),
    )
    expect(written.queries).toEqual(["hope", "faith"])
    expect(written.locale).toBe("en")
    expect(written.model).toBe("test-model")
  })

  it("returns cached queries without invoking the generator", async () => {
    const gen = fakeGenerator(["hope", "faith"])
    const loader = buildLoader(gen)

    await loader.loadOrGenerate("en", 2)
    await loader.loadOrGenerate("en", 2)

    expect(gen.generateQueries).toHaveBeenCalledTimes(1)
  })

  it("regenerate forces an overwrite", async () => {
    const gen = fakeGenerator(["a", "b"])
    const loader = buildLoader(gen)

    await loader.loadOrGenerate("en", 2)
    ;(gen.generateQueries as ReturnType<typeof vi.fn>).mockResolvedValue([
      "x",
      "y",
    ])
    const next = await loader.regenerate("en", 2)
    expect(next.map((q) => q.query)).toEqual(["x", "y"])

    const written = JSON.parse(
      await readFile(path.join(tmp, "en.json"), "utf8"),
    )
    expect(written.queries).toEqual(["x", "y"])
  })

  it("load() throws when no file exists", async () => {
    const gen = fakeGenerator([])
    const loader = buildLoader(gen)
    await expect(loader.load("xx")).rejects.toBeInstanceOf(QueryGeneratorError)
  })

  it("load() throws on schema mismatch", async () => {
    const gen = fakeGenerator([])
    const loader = buildLoader(gen)
    // write malformed file at a valid-BCP47 path
    const fs = await import("node:fs/promises")
    await fs.writeFile(
      path.join(tmp, "ba.json"),
      JSON.stringify({ wrong: true }),
      "utf8",
    )
    await expect(loader.load("ba")).rejects.toMatchObject({
      code: "validation",
    })
  })

  describe("locale validation (path-traversal guard)", () => {
    it("rejects path-traversal attempts", async () => {
      const gen = fakeGenerator([])
      const loader = buildLoader(gen)
      for (const evil of [
        "../foo",
        "../../etc/passwd",
        "..",
        "en/..",
        "en\\foo",
      ]) {
        await expect(loader.regenerate(evil)).rejects.toMatchObject({
          name: "QueryGeneratorError",
          code: "validation",
        })
        await expect(loader.loadOrGenerate(evil)).rejects.toMatchObject({
          code: "validation",
        })
        await expect(loader.load(evil)).rejects.toMatchObject({
          code: "validation",
        })
      }
    })

    it("rejects whitespace and unsafe characters", async () => {
      const gen = fakeGenerator([])
      const loader = buildLoader(gen)
      for (const bad of ["en bar", "en\nfoo", "en;rm", "en|cat", ""]) {
        await expect(loader.load(bad)).rejects.toMatchObject({
          code: "validation",
        })
      }
    })

    it("accepts canonical BCP-47 forms", async () => {
      const gen = fakeGenerator(["q"])
      const loader = buildLoader(gen)
      // These should bypass validation entirely; load() will still
      // throw because no file exists, but with a *different* error
      // code (request_failed) — confirming validation passed.
      for (const ok of ["en", "fr", "pt-PT", "zh-Hans", "es-419", "fil"]) {
        const result = await loader.regenerate(ok)
        expect(result[0]?.locale).toBe(ok)
      }
    })

    it("never invokes the generator when locale is invalid", async () => {
      const gen = fakeGenerator(["q"])
      const loader = buildLoader(gen)
      await expect(loader.regenerate("../evil")).rejects.toMatchObject({
        code: "validation",
      })
      expect(gen.generateQueries).not.toHaveBeenCalled()
    })
  })
})
