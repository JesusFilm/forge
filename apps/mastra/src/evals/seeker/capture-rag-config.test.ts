import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { expect, it } from "vitest"

const run = promisify(execFile)
const script = fileURLToPath(new URL("./capture-rag.ts", import.meta.url))
const loader = createRequire(import.meta.url).resolve("tsx")

it.each([false, true])(
  "captures with Seeker configuration, preserving CLI overrides (%s)",
  async (override) => {
    const directory = await mkdtemp(join(tmpdir(), "seeker-rag-config-"))
    const requests: {
      url: string | undefined
      authorization: string | undefined
    }[] = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
      })
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ results: [] }))
    })
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      )
      const address = server.address()
      if (!address || typeof address === "string")
        throw new Error("No test port")
      const base = `http://127.0.0.1:${address.port}`
      const output = join(directory, "fixtures.json")
      await run(
        process.execPath,
        [
          "--import",
          loader,
          script,
          `--out=${output}`,
          ...(override
            ? [`--base-url=${base}/override/`, "--api-key=cli-key"]
            : []),
        ],
        {
          cwd: directory,
          env: {
            NODE_ENV: "test",
            SEEKER_RAG_BASE_URL: base,
            SEEKER_RAG_API_KEY: "env-key",
          },
          timeout: 15_000,
        },
      )
      expect(requests.length).toBeGreaterThan(0)
      expect(
        requests.every(
          (request) =>
            request.url === (override ? "/override/v1/search" : "/v1/search") &&
            request.authorization ===
              `Bearer ${override ? "cli-key" : "env-key"}`,
        ),
      ).toBe(true)
      expect(JSON.parse(await readFile(output, "utf8"))).toHaveProperty(
        "fixtures",
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it("rejects retired capture variable names before making requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "seeker-rag-retired-"))
  try {
    await expect(
      run(process.execPath, ["--import", loader, script], {
        cwd: directory,
        env: {
          NODE_ENV: "test",
          RAG_BASE_URL: "http://127.0.0.1:1",
          RAG_API_KEY: "retired-key",
        },
        timeout: 15_000,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("SEEKER_RAG_API_KEY is not set"),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
