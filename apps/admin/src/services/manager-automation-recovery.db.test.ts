import { readFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import type { World } from "@workflow/world"
import { setWorld } from "workflow/runtime"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { MANAGER_BACKEND_PRINCIPAL as user } from "@/auth/principal"
import { ManagerAutomationService } from "./manager-automation.service"

const state = vi.hoisted(() => ({
  db: undefined as PrismaClient | undefined,
  runtimeId: "retired-runtime",
  env: {
    NODE_ENV: "test",
    MANAGER_AUTOMATIONS_ENABLED: "true",
    MANAGER_API_BASE_URL: "https://manager.test",
    MANAGER_AUTOMATION_API_KEY: "test-only",
  },
}))
vi.mock("@/db/client", () => ({
  get prisma() {
    return state.db
  },
}))
vi.mock("@/config/env", () => ({ env: state.env }))
vi.mock("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: state.runtimeId }),
  // Unexpected sleeping fails instead of leaving an infinite test workflow.
  sleep: async () => {
    throw new Error("Retired timer must not sleep")
  },
}))

const url = process.env.MANAGER_AUTOMATION_RECOVERY_TEST_DATABASE_URL
const draft = {
  name: "Manual recovery",
  template: "source_subtitles_missing",
  runMode: "dry_run",
  refreshMode: "missing_only",
  schedule: { kind: "every_minute", timezone: "UTC" },
  targetLanguageIds: [],
  maxVideosPerRun: 6,
}
const workflowKey = "manager-automation-scheduler"
;(url ? describe : describe.skip)(
  "automation recovery failure windows (disposable PG)",
  () => {
    let db: PrismaClient
    let setup: Client
    let checks: (() => unknown)[]
    let world: World

    beforeAll(async () => {
      if (
        url !==
        "postgresql://forge@127.0.0.1:55932/forge_automation_890_repair_09df2a57_recovery"
      )
        throw new Error("Task-owned recovery database on port 55932 required")
      setup = new Client({ connectionString: url })
      await setup.connect()
      await setup.query(
        "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS workflow CASCADE; CREATE SCHEMA workflow",
      )
      await setup.query(
        "CREATE TABLE language(id TEXT PRIMARY KEY, core_id TEXT, name JSONB DEFAULT '{}', deleted_at TIMESTAMP)",
      )
      for (const migration of [
        "0017_manager_backend_contracts",
        "0165_manager_automations",
        "0009_workflow_run_ledger",
      ]) {
        await setup.query(
          readFileSync(`prisma/migrations/${migration}/migration.sql`, "utf8"),
        )
      }
      // A deterministic World storage/queue adapter around the real installed start().
      // This is not a workflow worker or a provider: no external dispatch runs here.
      await setup.query(
        "CREATE TABLE workflow.workflow_runs(id TEXT PRIMARY KEY, status TEXT); CREATE TABLE workflow.test_queue(run_id TEXT)",
      )
      await setup.query(
        "CREATE OR REPLACE FUNCTION fail_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected identity persistence failure'; END $$",
      )
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      })
      state.db = db
    })
    beforeEach(async () => {
      vi.resetModules()
      state.runtimeId = "retired-runtime"
      state.env.MANAGER_AUTOMATIONS_ENABLED = "true"
      await setup.query(
        "DROP TRIGGER IF EXISTS fail_runtime_binding ON workflow_run; DROP TRIGGER IF EXISTS fail_running_status ON workflow_run; TRUNCATE manager_automation, workflow_run, workflow.workflow_runs, workflow.test_queue CASCADE",
      )
      checks = []
      const nativeTimeout = globalThis.setTimeout
      vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        callback: () => unknown,
        ms: number,
        ...args: unknown[]
      ) => {
        if (ms === 60_000) {
          checks.push(callback)
          return { unref() {} } as NodeJS.Timeout
        }
        return nativeTimeout(callback, ms, ...args)
      }) as typeof setTimeout)
      world = {
        getDeploymentId: async () => "test-deployment",
        events: {
          create: async (runId: string) => {
            await setup.query(
              "INSERT INTO workflow.workflow_runs(id,status) VALUES ($1,'running')",
              [runId],
            )
            return { run: { runId } }
          },
        },
        runs: {
          get: async (runId: string) => ({
            runId,
            workflowName:
              "workflow//./src/workflows/managerAutomation//runManagerAutomationScheduler",
            deploymentId: "test-deployment",
          }),
        },
        queue: async (_name: string, message: { runId: string }) => {
          await setup.query(
            "INSERT INTO workflow.test_queue(run_id) VALUES ($1)",
            [message.runId],
          )
          return { messageId: null }
        },
      } as unknown as World
      setWorld(world)
      const workflow = await import("@/workflows/managerAutomation")
      Object.assign(workflow.runManagerAutomationScheduler, {
        workflowId:
          "workflow//./src/workflows/managerAutomation//runManagerAutomationScheduler",
      })
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })
    afterAll(async () => {
      await db?.$disconnect()
      await setup?.end()
    })

    async function queued(createdAt = new Date(), runtimeRunId?: string) {
      return db.workflowRun.create({
        data: {
          workflowKey,
          workflowName: "Manager automation scheduler",
          trigger: "SYSTEM",
          createdAt,
          updatedAt: createdAt,
          runtimeRunId,
        },
      })
    }
    async function queueCount() {
      return Number(
        (await setup.query("SELECT count(*) FROM workflow.test_queue")).rows[0]
          .count,
      )
    }
    async function expireRun() {
      const service = new ManagerAutomationService(db)
      const automation = await service.create(user, draft)
      const lease = (await service.claim(user, automation.documentId))!
      const run = await service.createRun(user, {
        automationDocumentId: automation.documentId,
        leaseToken: lease.leaseToken,
        runMode: "dry_run",
        scheduledFor: new Date().toISOString(),
        idempotencyKey: "interrupted",
      })
      await db.managerAutomation.update({
        where: { id: automation.documentId },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      })
      return { service, automation, lease, run }
    }

    it("rechecks a committed no-ID ledger after grace without another process restart", async () => {
      const orphan = await queued()
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      await ensure()
      expect(await queueCount()).toBe(0)
      expect(checks).toHaveLength(1)
      await db.workflowRun.update({
        where: { id: orphan.id },
        data: {
          createdAt: new Date(Date.now() - 360_000),
          updatedAt: new Date(Date.now() - 360_000),
        },
      })
      await checks.shift()!()
      await vi.waitFor(async () => expect(await queueCount()).toBe(1))
      expect(
        (await db.workflowRun.findUniqueOrThrow({ where: { id: orphan.id } }))
          .status,
      ).toBe("FAILED")
      expect(checks).toHaveLength(1)
    })

    it("commits the actual generated identity before either World side effect", async () => {
      const unboundEffects: string[] = []
      const create = world.events.create,
        queue = world.queue
      world.events.create = (async (runId: string, ...args: unknown[]) => {
        const bound = await db.workflowRun.findUnique({
          where: { runtimeRunId: runId },
        })
        if (!bound) unboundEffects.push("create")
        return create(
          runId,
          ...(args as Parameters<typeof create> extends [unknown, ...infer Rest]
            ? Rest
            : never),
        )
      }) as typeof create
      world.queue = async (...args) => {
        const message = args[1]
        const bound =
          "runId" in message &&
          (await db.workflowRun.findUnique({
            where: { runtimeRunId: message.runId },
          }))
        if (!bound) unboundEffects.push("queue")
        return queue(...args)
      }
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      await ensure()
      expect(unboundEffects).toEqual([])
      const ledger = await db.workflowRun.findFirstOrThrow()
      expect(ledger.runtimeRunId).toMatch(/^wrun_/)
      expect(
        (await setup.query("SELECT id FROM workflow.workflow_runs")).rows[0].id,
      ).toBe(ledger.runtimeRunId)
      await ensure()
      expect(await queueCount()).toBe(1)
    })

    it("creates no runtime when durable runtime-ID binding fails", async () => {
      await setup.query(`CREATE OR REPLACE FUNCTION fail_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected identity persistence failure'; END $$;
      CREATE TRIGGER fail_runtime_binding BEFORE UPDATE ON workflow_run FOR EACH ROW WHEN (NEW.runtime_run_id IS NOT NULL AND OLD.runtime_run_id IS NULL) EXECUTE FUNCTION fail_binding()`)
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      await expect(ensure()).rejects.toThrow()
      expect(await queueCount()).toBe(0)
      expect(
        (await setup.query("SELECT * FROM workflow.workflow_runs")).rowCount,
      ).toBe(0)
      expect(checks).toHaveLength(1)
    })

    it("rejects a delayed start that binds only after its ledger was retired", async () => {
      let unblock!: () => void
      const waiting = new Promise<void>((resolve) => {
        unblock = resolve
      })
      world.getDeploymentId = vi
        .fn()
        .mockImplementationOnce(async () => {
          await waiting
          return "test-deployment"
        })
        .mockResolvedValue("test-deployment")
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      const starting = expect(ensure()).rejects.toThrow("retired before start")
      await vi.waitFor(async () => expect(await db.workflowRun.count()).toBe(1))
      await db.workflowRun.updateMany({
        data: { updatedAt: new Date(Date.now() - 360_000) },
      })
      try {
        await ensure()
      } finally {
        unblock()
      }
      await starting
      expect(await queueCount()).toBe(1)
      expect(
        (await setup.query("SELECT id FROM workflow.workflow_runs")).rowCount,
      ).toBe(1)
    })

    it("exits a late runtime whose durable binding preceded recovery", async () => {
      let unblock!: () => void
      const waiting = new Promise<void>((resolve) => {
        unblock = resolve
      })
      world.getEncryptionKeyForRun = vi
        .fn()
        .mockImplementationOnce(async () => {
          await waiting
          return undefined
        })
        .mockResolvedValue(undefined)
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      const starting = ensure()
      await vi.waitFor(async () =>
        expect((await db.workflowRun.findFirstOrThrow()).runtimeRunId).toMatch(
          /^wrun_/,
        ),
      )
      const original = await db.workflowRun.findFirstOrThrow()
      await db.workflowRun.updateMany({
        data: { updatedAt: new Date(Date.now() - 360_000) },
      })
      try {
        await ensure()
      } finally {
        unblock()
      }
      await starting
      expect(await queueCount()).toBe(2)
      expect(
        (await db.workflowRun.findUniqueOrThrow({ where: { id: original.id } }))
          .status,
      ).toBe("FAILED")
      state.runtimeId = original.runtimeRunId!
      state.env.MANAGER_AUTOMATIONS_ENABLED = "false"
      const { runManagerAutomationScheduler } =
        await import("@/workflows/managerAutomation")
      await expect(
        runManagerAutomationScheduler(original.id),
      ).resolves.toBeUndefined()
    })

    it("reconciles a successful runtime after the RUNNING ledger update fails", async () => {
      await setup.query(
        `CREATE TRIGGER fail_running_status BEFORE UPDATE ON workflow_run FOR EACH ROW WHEN (NEW.status='running') EXECUTE FUNCTION fail_binding()`,
      )
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      await expect(ensure()).rejects.toThrow()
      const ledger = await db.workflowRun.findFirstOrThrow()
      expect(ledger.runtimeRunId).toMatch(/^wrun_/)
      expect(ledger.status).toBe("QUEUED")
      await setup.query("DROP TRIGGER fail_running_status ON workflow_run")
      await ensure()
      expect(await queueCount()).toBe(2)
      expect(
        Number(
          (
            await setup.query(
              "SELECT count(DISTINCT run_id) FROM workflow.test_queue",
            )
          ).rows[0].count,
        ),
      ).toBe(1)
      expect(await db.workflowRun.count()).toBe(1)
    })

    it("re-enqueues the same bound runtime if start creates it but queueing fails", async () => {
      const queue = world.queue
      world.queue = vi
        .fn()
        .mockRejectedValueOnce(new Error("Injected queue outage"))
        .mockImplementation(queue)
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      await expect(ensure()).rejects.toThrow("Injected queue outage")
      const ledger = await db.workflowRun.findFirstOrThrow()
      expect(ledger.runtimeRunId).toMatch(/^wrun_/)
      expect(await queueCount()).toBe(0)
      expect(
        (await setup.query("SELECT id FROM workflow.workflow_runs")).rowCount,
      ).toBe(1)
      await ensure()
      expect(await queueCount()).toBe(1)
      expect(
        (await setup.query("SELECT run_id FROM workflow.test_queue")).rows[0]
          .run_id,
      ).toBe(ledger.runtimeRunId)
      expect(await db.workflowRun.count()).toBe(1)
    })

    it("retires a missing bound runtime after grace and exits its late timer before sleep", async () => {
      const retired = await queued(
        new Date(Date.now() - 360_000),
        state.runtimeId,
      )
      const { ensureManagerAutomationSchedulerStarted: ensure } =
        await import("./manager-automation-scheduler")
      await ensure()
      expect(await queueCount()).toBe(1)
      // Even disabled schedulers must let retired durable workflows exit.
      state.env.MANAGER_AUTOMATIONS_ENABLED = "false"
      const { runManagerAutomationScheduler } =
        await import("@/workflows/managerAutomation")
      await expect(
        runManagerAutomationScheduler(retired.id),
      ).resolves.toBeUndefined()
    })

    it("waits for a requested parent lock, retires its old run, then admits one replacement", async () => {
      const { service, automation, lease, run } = await expireRun()
      const lock = new Client({ connectionString: url })
      await lock.connect()
      await lock.query("BEGIN")
      await lock.query(
        "SELECT id FROM manager_automation WHERE id=$1 FOR UPDATE",
        [automation.documentId],
      )
      const replacement = service.claim(user, automation.documentId)
      try {
        await vi.waitFor(async () => {
          const blocked = await setup.query(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%manager_automation%'",
          )
          expect(Number(blocked.rows[0].count)).toBeGreaterThan(0)
        })
      } finally {
        await lock.query("COMMIT")
        await lock.end()
      }
      const claimed = (await replacement)!
      expect(claimed.leaseToken).not.toBe(lease.leaseToken)
      expect(await service.getRun(user, run.documentId)).toMatchObject({
        status: "failed",
      })
      const next = await service.createRun(user, {
        automationDocumentId: automation.documentId,
        leaseToken: claimed.leaseToken,
        runMode: "dry_run",
        scheduledFor: new Date().toISOString(),
      })
      expect(next.documentId).not.toBe(run.documentId)
      expect(
        await db.managerAutomationRun.count({
          where: { activeAutomationId: automation.documentId },
        }),
      ).toBe(1)
      expect(
        await service.beginDispatch(user, run.documentId, lease.leaseToken),
      ).toBe(false)
    })

    it("recovers interrupted manual work with the scheduler disabled and preserves cadence", async () => {
      const { service, automation, run } = await expireRun()
      state.env.MANAGER_AUTOMATIONS_ENABLED = "false"
      expect(await service.hasInFlight(user, automation.documentId)).toBe(false)
      const claims = await Promise.all(
        Array.from({ length: 6 }, () =>
          new ManagerAutomationService(db).claim(user, automation.documentId),
        ),
      )
      expect(claims.filter(Boolean)).toHaveLength(1)
      expect(await service.getRun(user, run.documentId)).toMatchObject({
        status: "failed",
      })
      expect((await service.get(user, automation.documentId))!.nextRunAt).toBe(
        automation.nextRunAt,
      )
    })
  },
)
