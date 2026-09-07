import { finishStudioExecution } from "./execution"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Pool } from "pg"
import { expect, test, vi } from "vitest"
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose"
import { MockLanguageModelV3 } from "ai/test"
import { PostgresStore } from "@mastra/pg"
import { signStudioRequest, type StudioCaller } from "@forge/studio-server"
import { createCalendarRuntime } from "./calendar-runtime"
import { createCalendarInstructions } from "./calendar-planner"
const url = process.env.STUDIO_CALENDAR_TEST_DATABASE_URL

test.skipIf(!url)(
  "signed native planning binds input and authority, pins versions and refuses replay after reconstruction",
  async () => {
    if (url !== "postgresql://tataihono@127.0.0.1:55461/forge_studio_461_test")
      throw new Error("Task-owned database required")
    const pool = new Pool({ connectionString: url, max: 2 })
    const store = new PostgresStore({
      id: "calendar-runtime-test",
      connectionString: url,
      schemaName: "studio461_runtime",
    })
    const restarted = new PostgresStore({
      id: "calendar-runtime-restart",
      connectionString: url,
      schemaName: "studio461_runtime",
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
      await store.init()
      const instructions = createCalendarInstructions(store),
        initial = await instructions.inspect()
      await instructions.activate(
        initial.latest.id,
        initial.activeVersionId,
        "operator",
      )
      const pair = await generateKeyPair("EdDSA", { extractable: true }),
        privateKey = await exportPKCS8(pair.privateKey),
        publicKeys = JSON.stringify({ test: await exportSPKI(pair.publicKey) })
      const observed: string[] = []
      const model = new MockLanguageModelV3({
        doStream: async (options) => {
          observed.push(
            options.prompt
              .filter((message) => message.role === "system")
              .map((message) => message.content)
              .join("\n"),
          )
          expect(options.tools ?? []).toHaveLength(0)
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: "stream-start", warnings: [] })
                controller.enqueue({ type: "text-start", id: "text" })
                controller.enqueue({
                  type: "text-delta",
                  id: "text",
                  delta: '{"items":[]}',
                })
                controller.enqueue({ type: "text-end", id: "text" })
                controller.enqueue({
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
                controller.close()
              },
            }),
          }
        },
      })
      const config = {
        finish: async (id: string, status: "completed" | "failed") => {
          await pool.query(
            "UPDATE studio_agent_execution SET status=$2 WHERE id=$1 AND status='running'",
            [id, status],
          )
        },
        publicKeys,
        environment: "local",
        admissionSecret: randomUUID(),
        model,
        serialize: async <T>(work: () => Promise<T>) => work(),
        claim: async (id: string, digest: string) => {
          const row = await pool.query(
            "INSERT INTO studio_agent_execution(id,instruction_digest) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
            [id, digest],
          )
          return row.rowCount === 1
        },
      }
      const runtime = createCalendarRuntime(store, config)
      const caller: StudioCaller = {
        sub: "calendar-workflow",
        authority: "delegated",
        clientId: "studio-calendar",
        scopes: ["studio:calendar:plan", "studio:instructions:read"],
      }
      const request = async (payload: unknown, actor = caller) => {
        const body = JSON.stringify(payload)
        const assertion = await signStudioRequest(
          body,
          "forge-mastra:studio-calendar",
          actor,
          { privateKey, keyId: "test", environment: "local" },
        )
        return new Request("http://localhost/forge-studio-calendar", {
          method: "POST",
          headers: { "x-forge-studio-service": assertion },
          body,
        })
      }
      expect(
        (
          await runtime(
            new Request("http://localhost/forge-studio-calendar", {
              method: "POST",
              body: "{}",
            }),
          )
        ).status,
      ).toBe(403)
      // The built Hono server replaces global Response; its static json()
      // can still return the original constructor's response.
      const NativeResponse = Response
      class ServerResponse extends NativeResponse {
        static json(data: unknown, init?: ResponseInit) {
          return NativeResponse.json(data, init)
        }
      }
      vi.stubGlobal("Response", ServerResponse)
      try {
        const inspected = await runtime(
          await request({
            action: "instructions",
            command: { action: "inspect" },
          }),
        )
        expect(inspected.status).toBe(200)
        expect((await inspected.json()).result.latest.id).toBeTruthy()
      } finally {
        vi.stubGlobal("Response", NativeResponse)
      }
      const input = {
          calendarId: "test-calendar",
          version: 1,
          language: "english",
          slots: [
            {
              date: "2026-09-22",
              version: 0,
              packRevisionIds: ["pack"],
              weeklyTheme: "",
            },
          ],
          packs: [
            {
              revisionId: "pack",
              document: { title: "Hope", guidance: "Hope titles", sources: [] },
            },
          ],
        },
        runId = randomUUID()
      const frozenResponse = await runtime(
        await request({ action: "freeze", runId, input }),
      )
      expect(frozenResponse.status).toBe(200)
      const {
        result: { admission },
      } = await frozenResponse.json()
      const command = { action: "run", runId, input, admission }
      expect(
        (
          await runtime(
            await request({ ...command, input: { ...input, version: 2 } }),
          )
        ).status,
      ).toBe(403)
      expect(
        (
          await runtime(
            await request(command, { ...caller, authority: "interactive" }),
          )
        ).status,
      ).toBe(403)
      expect(
        (
          await runtime(
            await request({
              action: "instructions",
              command: {
                action: "activate",
                versionId: initial.latest.id,
                expectedActiveVersionId: initial.latest.id,
              },
            }),
          )
        ).status,
      ).toBe(403)
      const draft = await instructions.save(
        initial.latest.id,
        "Changed after freeze",
        "operator",
      )
      await instructions.activate(
        draft.latest.id,
        initial.latest.id,
        "operator",
      )
      const response = await runtime(await request(command))
      expect(response.status).toBe(200)
      expect(
        (await response.json()).result.instructions[0].agentVersionId,
      ).toBe(initial.latest.id)
      expect(observed).toHaveLength(1)
      expect(observed[0]).toContain(initial.latest.content)
      expect(
        (await createCalendarRuntime(restarted, config)(await request(command)))
          .status,
      ).toBe(409)
      expect(observed).toHaveLength(1)
      async function anotherCommand() {
        const id = randomUUID()
        const response = await runtime(
          await request({ action: "freeze", runId: id, input }),
        )
        const body = await response.json()
        return {
          action: "run",
          runId: id,
          input,
          admission: body.result.admission,
        }
      }
      const ambiguous = await anotherCommand(),
        transitions: string[] = []
      const ambiguousRuntime = createCalendarRuntime(store, {
        ...config,
        finish: async (id, status) => {
          transitions.push(status)
          await config.finish(id, status)
          throw new Error("Connection lost after committed terminal write")
        },
      })
      expect((await ambiguousRuntime(await request(ambiguous))).status).toBe(
        400,
      )
      expect(transitions).toEqual(["completed"])
      expect(
        (
          await pool.query(
            "SELECT status FROM studio_agent_execution WHERE id=$1",
            ["calendar:" + ambiguous.runId],
          )
        ).rows[0].status,
      ).toBe("completed")
      expect((await runtime(await request(ambiguous))).status).toBe(409)
      const blocked = await anotherCommand(),
        lock = await pool.connect()
      const blockedTransitions: string[] = []
      try {
        const blockedRuntime = createCalendarRuntime(store, {
          ...config,
          finish: async (id, status, context) => {
            blockedTransitions.push(status)
            expect(context.timeoutMs).toBeLessThanOrEqual(5000)
            await lock.query("BEGIN")
            await lock.query(
              "SELECT id FROM studio_agent_execution WHERE id=$1 FOR UPDATE",
              [id],
            )
            return finishStudioExecution(pool, id, status, context)
          },
        })
        const started = performance.now()
        const response = await blockedRuntime(await request(blocked))
        expect(response.status).toBe(403)
        expect((await response.json()).error).toContain("persistence")
        expect(performance.now() - started).toBeLessThan(7000)
        expect(blockedTransitions).toEqual(["completed"])
      } finally {
        await lock.query("ROLLBACK")
        lock.release()
      }
      expect((await runtime(await request(blocked))).status).toBe(409)
      const cancelled = await anotherCommand(),
        abort = new AbortController()
      abort.abort()
      expect(
        (
          await runtime(
            new Request(await request(cancelled), { signal: abort.signal }),
          )
        ).status,
      ).toBe(403)
      expect(
        (
          await pool.query(
            "SELECT id FROM studio_agent_execution WHERE id=$1",
            ["calendar:" + cancelled.runId],
          )
        ).rowCount,
      ).toBe(0)
      await instructions.restore(initial.latest.id, draft.latest.id, "operator")
    } finally {
      await store.close()
      await restarted.close()
      await pool.end()
    }
  },
  20000,
)
