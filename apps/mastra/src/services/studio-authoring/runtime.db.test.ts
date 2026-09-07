import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Pool } from "pg"
import { afterAll, expect, test } from "vitest"
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose"
import { MockLanguageModelV3 } from "ai/test"
import { PostgresStore } from "@mastra/pg"
import { signStudioRequest } from "@forge/studio-server"
import { studioProjectSchema } from "@forge/studio-contracts"
import { env } from "../../config/env"
import { StudioInstructions } from "./instructions"
import { createStudioRuntime } from "./runtime"
const url = env.STUDIO_TEST_DATABASE_URL
const servers: ReturnType<typeof createServer>[] = []
afterAll(() => {
  for (const server of servers) server.close()
})
async function serve(handler: (r: Request) => Promise<Response>) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const response = await handler(
      new Request("http://127.0.0.1/forge-studio", {
        method: "POST",
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      }),
    )
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) {
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      } finally {
        reader.releaseLock()
      }
    }
    res.end()
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Missing listener")
  return `http://127.0.0.1:${address.port}`
}
test.skipIf(!url)(
  "two native HTTP runtimes execute pinned bytes once despite active changes and reconstruction",
  async () => {
    if (
      ![
        "postgresql://tataihono@127.0.0.1:55457/forge_studio_457_test",
        "postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test",
      ].includes(url!)
    )
      throw new Error("Dedicated457 database only")
    const pool = new Pool({ connectionString: url }),
      a = new PostgresStore({
        id: "runtime-a",
        connectionString: url,
        schemaName: "studio457_runtime",
      }),
      b = new PostgresStore({
        id: "runtime-b",
        connectionString: url,
        schemaName: "studio457_runtime",
      })
    try {
      await pool.query(
        await readFile(
          new URL(
            "../../../migrations/004-studio-agent-execution.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      )
      await a.init()
      await b.init()
      const pair = await generateKeyPair("EdDSA", { extractable: true }),
        privateKey = await exportPKCS8(pair.privateKey),
        publicKeys = JSON.stringify({ test: await exportSPKI(pair.publicKey) })
      const observed: string[] = []
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          observed.push(
            options.prompt
              .filter((m) => m.role === "system")
              .map((m) => m.content)
              .join("\n"),
          )
          return {
            stream: new ReadableStream({
              start(c) {
                c.enqueue({ type: "stream-start", warnings: [] })
                c.enqueue({ type: "text-start", id: "text" })
                c.enqueue({
                  type: "text-delta",
                  id: "text",
                  delta: "Local deterministic reply",
                })
                c.enqueue({ type: "text-end", id: "text" })
                c.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: {
                    inputTokens: {
                      total: 1,
                      noCache: 1,
                      cacheRead: 0,
                      cacheWrite: 0,
                    },
                    outputTokens: { total: 1, text: 1, reasoning: 0 },
                  },
                })
                c.close()
              },
            }),
          }
        },
      })
      const config = {
        publicKeys,
        environment: "local",
        admissionSecret: "disposable-native-admission-secret-457",
        model,
        serialize: async <T>(work: () => Promise<T>) => {
          const c = await pool.connect()
          try {
            await c.query("SELECT pg_advisory_lock(457)")
            return await work()
          } finally {
            try {
              await c.query("SELECT pg_advisory_unlock(457)")
            } finally {
              c.release()
            }
          }
        },
        claim: async (id: string, digest: string) =>
          (
            await pool.query(
              "INSERT INTO studio_agent_execution(id,instruction_digest) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
              [id, digest],
            )
          ).rowCount === 1,
        finish: async (id: string, status: "completed" | "failed") => {
          await pool.query(
            "UPDATE studio_agent_execution SET status=$2 WHERE id=$1",
            [id, status],
          )
        },
      }
      const first = await serve(createStudioRuntime(a, config)),
        second = await serve(createStudioRuntime(b, config))
      async function call(
        base: string,
        raw: unknown,
        authority: "interactive" | "delegated" = "interactive",
      ) {
        const body = JSON.stringify(raw),
          assertion = await signStudioRequest(
            body,
            "forge-mastra:studio",
            {
              sub: "operator",
              authority,
              clientId: "studio-test",
              scopes: ["studio:chat", "studio:instructions:read"],
            },
            { privateKey, keyId: "test", environment: "local" },
          )
        return fetch(base, {
          method: "POST",
          headers: { "x-forge-studio-service": assertion },
          body,
        })
      }
      const ins = new StudioInstructions(a),
        initial = await ins.inspect(),
        saved = await ins.save(
          initial.latest.id,
          "FROZEN {{language}}",
          "operator",
        )
      await ins.activate(saved.latest.id, initial.activeVersionId, "operator")
      const project = studioProjectSchema.parse({
        projectId: randomUUID(),
        revision: 1,
        lifecycle: "DRAFT",
        firstPublishedAt: null,
        actor: { kind: "human", id: "operator" },
        document: {
          version: 1,
          title: "Before",
          language: "en",
          runtimeVersion: "studio-test",
          width: 1080,
          height: 1920,
          fps: 30,
          durationInFrames: 300,
          tracks: [],
          items: [],
          components: [],
          packRevisionIds: [],
        },
      })
      const input = {
        projectId: project.projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        message: "Hello",
      }
      const expectedFrozen = await ins.freeze(
        { mode: "active" },
        { language: "en" },
      )
      const frozenResponse = await call(first, {
          action: "freeze",
          input,
          project,
        }),
        frozen = (await frozenResponse.json()).result
      expect(frozenResponse.status).toBe(200)
      const newer = await ins.save(saved.latest.id, "NEW ACTIVE", "operator")
      await ins.activate(newer.latest.id, saved.latest.id, "operator")
      const blocks = (await a.getStore("promptBlocks"))!,
        latest = (await blocks.getLatestVersion("studio-authoring-voice"))!
      await blocks.createVersion({
        id: randomUUID(),
        blockId: "studio-authoring-voice",
        versionNumber: latest.versionNumber + 1,
        name: "changed",
        content: "NEW BLOCK",
      })
      await blocks.update({
        id: "studio-authoring-voice",
        activeVersionId: (await blocks.getLatestVersion(
          "studio-authoring-voice",
        ))!.id,
        status: "published",
      })
      const run = {
        action: "run",
        admission: frozen.admission,
        attemptId: `c${randomUUID().replaceAll("-", "")}`,
        inputKey: input.idempotencyKey,
        project,
        message: input.message,
      }
      expect((await call(second, run)).status).toBe(409)
      const bound = await call(first, { ...run, action: "bind" })
      run.admission = (await bound.json()).result.admission
      expect(
        (await call(second, { ...run, attemptId: randomUUID() })).status,
      ).toBe(409)
      const response = await call(second, run)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('"type":"done"')
      expect(observed[0]).toContain("FROZEN en")
      expect(observed[0]).not.toContain("NEW ACTIVE")
      expect(observed[0]).toBe(expectedFrozen.effective)
      // Reconstructing the handler has no process-local admission/claim state.
      const restarted = await serve(createStudioRuntime(b, config))
      expect((await call(restarted, run)).status).toBe(409)
      for (const status of ["running", "failed"]) {
        const consumed = {
          ...run,
          attemptId: `c${randomUUID().replaceAll("-", "")}`,
          admission: frozen.admission,
        }
        const rebound = await call(first, { ...consumed, action: "bind" })
        consumed.admission = (await rebound.json()).result.admission
        await pool.query(
          "INSERT INTO studio_agent_execution(id,instruction_digest,status) VALUES($1,$2,$3)",
          [consumed.attemptId, frozen.provenance.digest, status],
        )
        expect((await call(restarted, consumed)).status).toBe(409)
      }
      expect(observed).toHaveLength(1)

      expect(
        (
          await call(restarted, {
            ...run,
            attemptId: randomUUID(),
            message: "tampered",
          })
        ).status,
      ).toBe(409)
      expect(
        (
          await call(
            second,
            {
              action: "instructions",
              command: {
                action: "activate",
                versionId: saved.latest.id,
                expectedActiveVersionId: newer.latest.id,
              },
            },
            "delegated",
          )
        ).status,
      ).toBe(403)
      const languageTest = await call(restarted, {
        action: "test",
        language: "english",
        selection: {
          mode: "version",
          versionId: saved.latest.id,
          blockVersionId: frozen.provenance.blockVersionId,
        },
        message: "Test language",
      })
      expect(languageTest.status).toBe(200)
      expect(await languageTest.text()).toContain('"type":"done"')
      expect(observed.at(-1)).toContain("FROZEN english")
      expect((await ins.inspect()).activeVersionId).toBe(newer.latest.id)
      expect((await fetch(first, { method: "POST", body: "{}" })).status).toBe(
        403,
      )
    } finally {
      await a.close()
      await b.close()
      await pool.end()
    }
  },
  30000,
)
