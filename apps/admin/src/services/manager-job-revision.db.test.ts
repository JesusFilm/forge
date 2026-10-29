import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { MANAGER_BACKEND_PRINCIPAL as user } from "@/auth/principal"
import type { ContextShape } from "@/graphql/builder"
import { schema as graphqlSchema } from "@/graphql/schema"
import { ManagerExecutionService } from "./manager-execution.service"
import { ManagerJobService } from "./manager-job.service"

const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")
const databaseUrl = env.MANAGER_EXECUTION_TEST_DATABASE_URL

// Actual Manager code runs in separate Node processes with independent mutexes,
// raw GraphQL clients, and the callback HTTP route. Only the Admin service sees PG.
// A response barrier holds snapshots AFTER the real GraphQL read has finished.
describe.skipIf(!databaseUrl)(
  "distributed Manager job revisions on Postgres",
  () => {
    const schema = `callback_${randomUUID().replaceAll("-", "")}`
    let admin: Client
    let left: PrismaClient
    let right: PrismaClient
    let server: Server
    let origin: string
    let readBarrier: (() => Promise<void>) | undefined
    const expectedRevisions: unknown[] = []
    let requests = 0

    beforeAll(async () => {
      const target = new URL(databaseUrl!)
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
        !target.pathname.endsWith("_test")
      ) {
        throw new Error(
          "Revision tests require an explicit loopback _test database",
        )
      }
      admin = new Client({ connectionString: databaseUrl })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}"`)
      for (const migration of [
        "0017_manager_backend_contracts",
        "0166_manager_execution_operations",
        "0167_manager_job_revision",
      ]) {
        await admin.query(
          readFileSync(
            new URL(
              `../../prisma/migrations/${migration}/migration.sql`,
              import.meta.url,
            ),
            "utf8",
          ),
        )
      }
      target.searchParams.set("schema", schema)
      left = new PrismaClient({
        datasources: { db: { url: target.toString() } },
      })
      right = new PrismaClient({
        datasources: { db: { url: target.toString() } },
      })
      server = createServer((req, res) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.from(chunk))
          const { query, variables } = JSON.parse(
            Buffer.concat(chunks).toString(),
          ) as { query: string; variables: Record<string, unknown> }
          if (query.includes("mutation UpdateManagerJob"))
            expectedRevisions.push(variables.expectedRevision)
          const result = await graphql({
            schema: graphqlSchema,
            source: query,
            variableValues: variables,
            contextValue: {
              user,
              services: {
                managerJob: new ManagerJobService(
                  requests++ % 2 ? left : right,
                ),
              },
            } as unknown as ContextShape,
          })
          if (query.includes("query ManagerJob(")) await readBarrier?.()
          res.setHeader("content-type", "application/json")
          res.end(JSON.stringify(result))
        })().catch((error: unknown) => {
          res.statusCode = 500
          res.end(String(error))
        })
      })
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      )
      const address = server.address()
      if (!address || typeof address === "string")
        throw new Error("Missing test server port")
      origin = `http://127.0.0.1:${address.port}`
    })

    beforeEach(async () => {
      readBarrier = undefined
      expectedRevisions.length = 0
      await admin.query('TRUNCATE "manager_enrichment_job" CASCADE')
      await left.managerEnrichmentJob.create({
        data: {
          id: "revision-job",
          muxAssetId: "fixture",
          muxPlaybackId: "fixture",
          languages: ["fr"],
          options: { engine: "mastra", currentRunId: "run-a", uploadMux: true },
          status: "running",
          steps: [
            { name: "chapters", status: "pending", retries: 0 },
            { name: "metadata", status: "pending", retries: 0 },
          ],
        },
      })
    })

    afterAll(async () => {
      readBarrier = undefined
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      await Promise.all([left?.$disconnect(), right?.$disconnect()])
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    function holdSnapshots(count = 1) {
      let release!: () => void
      let reached!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const ready = new Promise<void>((resolve) => {
        reached = resolve
      })
      let remaining = count
      readBarrier = async () => {
        if (remaining <= 0) return
        remaining--
        if (remaining === 0) reached()
        await held
      }
      return { ready, release }
    }

    async function manager(action: string) {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          createRequire(import.meta.url).resolve("tsx/cli"),
          "--eval",
          `import * as state from './src/lib/state.ts';
       import { POST } from './src/app/api/internal/enrichment-callback/route.ts';
       import { subscribeToAllJobEvents } from './src/lib/job-events.ts';
       (async () => {
         let events = 0; subscribeToAllJobEvents(() => events++);
         const callback = async (step = 'chapters') => {
           const attempts = [];
           for (let n = 0; n < 4; n++) {
             const response = await POST(new Request('http://manager.test/callback', {
               method: 'POST', headers: { authorization: 'Bearer fixture-callback' },
               body: JSON.stringify({ jobId: 'revision-job', engine: 'mastra', runId: 'run-a', step, status: 'completed', sequence: 1, artifactsDelta: [step] })
             }));
             attempts.push({ status: response.status, body: await response.json() });
             if (response.status !== 503) break;
           }
           return attempts;
         };
         const result = await (${action});
         console.log(JSON.stringify({ result, events }));
       })().catch((error) => { console.error(error); process.exitCode = 1; });`,
        ],
        {
          cwd: fileURLToPath(new URL("../../../manager/", import.meta.url)),
          env: {
            ...process.env,
            CI: "1",
            MANAGER_BACKEND_MODE: "admin",
            MANAGER_SESSION_SECRET: "fixture-manager-session-secret-00000000",
            AUTH_ISSUER_URL: "https://auth.example.test",
            AUTH_MANAGER_CLIENT_ID: "fixture-manager",
            ADMIN_GRAPHQL_URL: origin,
            ADMIN_MANAGER_API_KEY: "fixture-admin",
            ENRICHMENT_CALLBACK_API_KEYS: "fixture-callback",
            ADMIN_TRIGGER_API_KEYS: "fixture-trigger",
          },
          timeout: 15000,
        },
      )
      return JSON.parse(stdout.trim()) as {
        result: Array<{
          status: number
          body: { action?: string; reason?: string }
        }> | null
        events: number
      }
    }

    async function replaceOwner() {
      const current = await new ManagerJobService(right).get({
        user,
        id: "revision-job",
      })
      return new ManagerJobService(right).update({
        user,
        id: current.id,
        expectedRevision: current.revision,
        input: {
          options: { ...(current.options as object), currentRunId: "run-b" },
        },
      })
    }

    it("rejects a held callback after operations finish and ownership transfers; retry drops stale_run", async () => {
      const operations = new ManagerExecutionService(left)
      const input = {
        jobId: "revision-job",
        runId: "run-a",
        inputDigest: "a".repeat(64),
        operationId: "run-admission",
        operationDigest: "b".repeat(64),
      }
      const claim = await operations.claim({ user, input })
      await operations.complete({
        user,
        input: { ...input, claimToken: claim.claimToken!, result: {} },
      })
      const hold = holdSnapshots()
      const callback = manager("callback()")
      try {
        await Promise.race([
          hold.ready,
          callback.then((result) => {
            throw new Error(
              `Callback exited before snapshot: ${JSON.stringify(result)}`,
            )
          }),
        ])
        await replaceOwner()
      } finally {
        hold.release()
      }
      expect(await callback).toMatchObject({
        events: 0,
        result: [
          { status: 503 },
          { status: 200, body: { action: "dropped", reason: "stale_run" } },
        ],
      })
      expect(expectedRevisions).toEqual([0])
      expect(
        await new ManagerJobService(left).get({ user, id: "revision-job" }),
      ).toMatchObject({
        revision: 1,
        options: { currentRunId: "run-b" },
        artifacts: {},
      })
    }, 20000)

    it.each(["metadata", "chapters"])(
      "independent parallel callbacks for chapters and %s refetch on conflict",
      async (step) => {
        const hold = holdSnapshots(2)
        const a = manager("callback('chapters')")
        const b = manager(`callback('${step}')`)
        try {
          await Promise.race([
            hold.ready,
            a.then((result) => {
              throw new Error(
                `First callback exited before snapshot: ${JSON.stringify(result)}`,
              )
            }),
            b.then((result) => {
              throw new Error(
                `Second callback exited before snapshot: ${JSON.stringify(result)}`,
              )
            }),
          ])
        } finally {
          hold.release()
        }
        const results = await Promise.all([a, b])
        expect(
          results
            .flatMap((r) => r.result ?? [])
            .filter((a) => a.status === 503),
        ).toHaveLength(1)
        const job = await new ManagerJobService(left).get({
          user,
          id: "revision-job",
        })
        if (step === "metadata") {
          expect(results.map((r) => r.events)).toEqual([1, 1])
          expect(job).toMatchObject({
            revision: 2,
            artifacts: {
              chapters: { kind: "downloadable" },
              metadata: { kind: "downloadable" },
            },
            options: { callbackSequences: { chapters: 1, metadata: 1 } },
          })
          expect(expectedRevisions).toEqual([0, 0, 1])
        } else {
          expect(results.reduce((n, r) => n + r.events, 0)).toBe(1)
          expect(results.flatMap((r) => r.result ?? [])).toContainEqual({
            status: 200,
            body: { ok: true, action: "dropped", reason: "stale_sequence" },
          })
          expect(job.revision).toBe(1)
        }
      },
      20000,
    )

    it.each([
      "state.markEnrichmentDispatched('revision-job', 'older-dispatch')",
      "state.resetEnrichmentForRerun('revision-job', {})",
      "state.restampEngine('revision-job', 'workflow')",
      "state.failMastraEnrichmentIfNoCallback('revision-job', 'run-a')",
    ])(
      "a held state writer cannot overwrite a newly admitted run: %s",
      async (action) => {
        const hold = holdSnapshots()
        const pending = manager(action)
        try {
          await Promise.race([
            hold.ready,
            pending.then(() => {
              throw new Error("Ownership writer exited before snapshot")
            }),
          ])
          await replaceOwner()
        } finally {
          hold.release()
        }
        expect(await pending).toEqual({
          result: action.includes("failMastra")
            ? { status: "error", error: {} }
            : null,
          events: 0,
        })
        expect(expectedRevisions).toEqual([0])
        expect(
          await new ManagerJobService(left).get({ user, id: "revision-job" }),
        ).toMatchObject({
          revision: 1,
          options: { engine: "mastra", currentRunId: "run-b", uploadMux: true },
        })
      },
      20000,
    )

    it("increments every update even when timestamps collide, including legacy unguarded writes", async () => {
      // A fixed DB timestamp makes timestamp-only CAS fail deterministically.
      await admin.query(
        `CREATE FUNCTION fixed_job_time() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := '2026-10-28T00:00:00Z'; RETURN NEW; END $$`,
      )
      await admin.query(
        `CREATE TRIGGER fixed_job_time BEFORE UPDATE ON manager_enrichment_job FOR EACH ROW EXECUTE FUNCTION fixed_job_time()`,
      )
      try {
        const jobs = new ManagerJobService(left)
        const first = await jobs.update({ user, id: "revision-job", input: {} })
        const second = await jobs.update({
          user,
          id: "revision-job",
          expectedRevision: first.revision,
          input: {},
        })
        expect(first.updatedAt).toBe(second.updatedAt)
        expect([first.revision, second.revision]).toEqual([1, 2])
        await expect(
          new ManagerJobService(right).update({
            user,
            id: "revision-job",
            expectedRevision: first.revision,
            input: {},
          }),
        ).rejects.toThrow("modified concurrently")
      } finally {
        await admin.query(
          "DROP TRIGGER fixed_job_time ON manager_enrichment_job",
        )
        await admin.query("DROP FUNCTION fixed_job_time()")
      }
    })
  },
)
