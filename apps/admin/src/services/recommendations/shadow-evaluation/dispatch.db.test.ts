import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { env } from "@/config/env"
import { HYBRID_CANDIDATE_GENERATOR_SET_VERSION } from "../candidate"
import { HYBRID_PERSONALIZED_MANIFEST } from "../promotion/manifest"
import { startExactHybridShadowEvaluation } from "./operator"
import { runRecommendationShadowEvaluationJob } from "./job"
import {
  dispatchRecommendationShadowEvaluation,
  finishRecommendationShadowDispatch,
  markRecommendationShadowEvaluationRuntimeStarted,
  type RecommendationShadowEvaluationJobInput,
} from "./dispatch"

const runtime = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn() }))
vi.mock("workflow/api", () => ({ start: runtime.start }))
vi.mock("workflow/runtime", () => ({
  getWorld: () => ({ runs: { get: runtime.get } }),
}))

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "shadow dispatch on PostgreSQL",
  () => {
    let db: PrismaClient
    const ids: string[] = []
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test"
      ) {
        throw new Error("Owned loopback forge_test database required")
      }
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
      })
      await db.recommendationStrategyManifest.upsert({
        where: { id: HYBRID_PERSONALIZED_MANIFEST.id },
        create: HYBRID_PERSONALIZED_MANIFEST,
        update: {},
      })
    })
    beforeEach(() => {
      vi.restoreAllMocks()
      runtime.start
        .mockReset()
        .mockImplementation(async () => ({ runId: randomUUID() }))
      runtime.get.mockReset().mockResolvedValue({ status: "pending" })
    })
    afterAll(async () => {
      if (!db) return
      await db.workflowRun.deleteMany({ where: { subjectId: { in: ids } } })
      // Terminal evidence is immutable until expiry. The owned disposable
      // database is removed after validation rather than weakening its guards.
      await db.recommendationShadowEvaluation.deleteMany({
        where: { id: { in: ids }, state: { not: "TERMINAL" } },
      })
      await db.$disconnect()
    })
    function input() {
      const evaluationId = randomUUID()
      ids.push(evaluationId)
      const now = new Date()
      return {
        evaluationId,
        now,
        actorId: "owned-dispatch-fixture",
        minimumRuns: 2,
        requestedSampleSize: 5,
        windowStart: new Date(now.getTime() - 2 * 86_400_000),
        windowEnd: new Date(now.getTime() - 86_400_000),
      }
    }

    function failingClient(stage: "intent" | "attachment") {
      let failed = false
      // The real query still runs except at this one process-crash boundary.
      return db.$extends({
        query: {
          workflowRun: {
            updateMany({ args, query }) {
              if (!failed && (stage === "intent" || args.data.runtimeRunId)) {
                failed = true
                throw new Error(`crash before ${stage}`)
              }
              return query(args)
            },
          },
        },
      }) as unknown as PrismaClient
    }

    it("converges simultaneous admissions on one immutable dispatch before start", async () => {
      const request = input()
      let release!: () => void
      let entered!: () => void
      const holding = new Promise<void>((resolve) => {
        release = resolve
      })
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      runtime.start.mockImplementationOnce(async () => {
        entered()
        await holding
        return { runId: "runtime-race" }
      })
      const first = startExactHybridShadowEvaluation(db, request)
      await started
      try {
        const second = await startExactHybridShadowEvaluation(db, request)
        expect(second).toMatchObject({
          status: "dispatch_uncertain",
          dispatch: { queued: false, state: "uncertain" },
        })
        expect(
          await db.workflowRun.count({
            where: { subjectId: request.evaluationId },
          }),
        ).toBe(1)
        expect(runtime.start).toHaveBeenCalledOnce()
      } finally {
        release()
      }
      expect(await first).toMatchObject({
        status: "queued",
        dispatch: { state: "attached", runId: "runtime-race" },
      })
    })

    it("does not start again after the queue accepts but the caller loses the response", async () => {
      const request = input()
      runtime.start.mockRejectedValueOnce(new Error("accepted, response lost"))
      const first = await startExactHybridShadowEvaluation(db, request)
      expect(first).toMatchObject({
        status: "dispatch_uncertain",
        dispatch: { queued: false, runId: null },
      })
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        { status: "dispatch_uncertain" },
      )
      expect(runtime.start).toHaveBeenCalledOnce()
      expect(
        await db.workflowRun.findUnique({
          where: { id: first.dispatch.ledgerRunId },
        }),
      ).toMatchObject({ status: "QUEUED" })
    })

    it("races first admissions before any ledger exists and starts once", async () => {
      const request = input()
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          startExactHybridShadowEvaluation(db, request),
        ),
      )
      expect(
        new Set(results.map((result) => result.dispatch.ledgerRunId)).size,
      ).toBe(1)
      expect(runtime.start).toHaveBeenCalledOnce()
      expect(
        await db.workflowRun.count({
          where: { subjectId: request.evaluationId },
        }),
      ).toBe(1)
      expect(
        await db.recommendationShadowEvaluation.count({
          where: { id: request.evaluationId },
        }),
      ).toBe(1)
    })

    it("resumes a prepared reservation after a crash before claiming start", async () => {
      const request = input()
      const client = failingClient("intent")
      await expect(
        startExactHybridShadowEvaluation(client, request),
      ).rejects.toThrow("crash before intent")
      expect(runtime.start).not.toHaveBeenCalled()
      const prepared = await db.workflowRun.findFirstOrThrow({
        where: { subjectId: request.evaluationId },
      })
      expect(prepared.details).toMatchObject({ dispatchState: "prepared" })
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        { status: "queued", dispatch: { ledgerRunId: prepared.id } },
      )
      expect(runtime.start).toHaveBeenCalledOnce()
    })

    it("recovers through self-attachment after acknowledged start but lost attachment", async () => {
      const request = input()
      const result = await startExactHybridShadowEvaluation(
        failingClient("attachment"),
        request,
      )
      expect(result).toMatchObject({
        status: "dispatch_uncertain",
        dispatch: { state: "uncertain" },
      })
      const payload = runtime.start.mock
        .calls[0][1][0] as RecommendationShadowEvaluationJobInput
      expect(
        await markRecommendationShadowEvaluationRuntimeStarted(
          payload,
          result.dispatch.runId!,
          db,
        ),
      ).toBe(true)
      runtime.get.mockResolvedValueOnce({ status: "running" })
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        {
          status: "already_dispatched",
          dispatch: { state: "running", runId: result.dispatch.runId },
        },
      )
      expect(runtime.start).toHaveBeenCalledOnce()
    })

    it("keeps self-attached terminal evidence if start subsequently throws", async () => {
      const request = input()
      runtime.start.mockImplementationOnce(
        async (
          _workflow,
          [payload]: [RecommendationShadowEvaluationJobInput],
        ) => {
          expect(
            await markRecommendationShadowEvaluationRuntimeStarted(
              payload,
              "accepted-runtime",
              db,
            ),
          ).toBe(true)
          await finishRecommendationShadowDispatch(
            payload,
            "accepted-runtime",
            {
              status: "SUCCEEDED",
              summary: "Fixture decision",
              details: { decision: "inconclusive" },
            },
            db,
          )
          throw new Error("accepted but response lost")
        },
      )
      const result = await startExactHybridShadowEvaluation(db, request)
      expect(result).toMatchObject({
        status: "terminal",
        dispatch: { workflowStatus: "SUCCEEDED", runId: "accepted-runtime" },
      })
      const ledger = await db.workflowRun.findUniqueOrThrow({
        where: { id: result.dispatch.ledgerRunId },
      })
      expect(ledger.details).toMatchObject({
        dispatchVersion: "shadow-dispatch-v1",
        tuple: { minimumRuns: 2 },
        result: { decision: "inconclusive" },
      })
      expect(ledger.error).toBeNull()
    })

    it("fences a competing runtime and its terminal writes", async () => {
      const request = input()
      const result = await startExactHybridShadowEvaluation(db, request)
      const payload = runtime.start.mock
        .calls[0][1][0] as RecommendationShadowEvaluationJobInput
      const runtimeId = result.dispatch.runId!
      expect(
        await markRecommendationShadowEvaluationRuntimeStarted(
          payload,
          runtimeId,
          db,
        ),
      ).toBe(true)
      expect(
        await markRecommendationShadowEvaluationRuntimeStarted(
          payload,
          "different-runtime",
          db,
        ),
      ).toBe(false)
      expect(
        await markRecommendationShadowEvaluationRuntimeStarted(
          { ...payload, minimumRuns: 1 },
          runtimeId,
          db,
        ),
      ).toBe(false)
      await finishRecommendationShadowDispatch(
        payload,
        "different-runtime",
        { status: "FAILED", summary: "must not overwrite" },
        db,
      )
      const ledger = await db.workflowRun.findUniqueOrThrow({
        where: { id: result.dispatch.ledgerRunId },
      })
      expect(ledger).toMatchObject({
        status: "RUNNING",
        runtimeRunId: runtimeId,
        finishedAt: null,
      })
      await finishRecommendationShadowDispatch(
        payload,
        runtimeId,
        { status: "SUCCEEDED", summary: "owned result" },
        db,
      )
      expect(
        await markRecommendationShadowEvaluationRuntimeStarted(
          payload,
          runtimeId,
          db,
        ),
      ).toBe(false)
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        { status: "terminal" },
      )
      expect(runtime.start).toHaveBeenCalledOnce()
    })

    it.each(["completed", "failed", "cancelled"])(
      "reports %s runtime truth without starting again",
      async (status) => {
        const request = input()
        await startExactHybridShadowEvaluation(db, request)
        runtime.get.mockResolvedValueOnce({ status })
        expect(
          await startExactHybridShadowEvaluation(db, request),
        ).toMatchObject({
          status: "terminal",
          dispatch: { state: "terminal", runtimeStatus: status, queued: false },
        })
        expect(runtime.start).toHaveBeenCalledOnce()
      },
    )

    it("preserves uncertainty when an attached runtime cannot be read", async () => {
      const request = input()
      await startExactHybridShadowEvaluation(db, request)
      runtime.get.mockRejectedValueOnce(new Error("World unavailable"))
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        { status: "dispatch_uncertain", dispatch: { queued: false } },
      )
      expect(runtime.start).toHaveBeenCalledOnce()
    })

    it("bounds a stalled World read and does not infer safe retry", async () => {
      const request = input()
      await startExactHybridShadowEvaluation(db, request)
      runtime.get.mockImplementationOnce(() => new Promise(() => {}))
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        { status: "dispatch_uncertain" },
      )
      expect(runtime.get).toHaveBeenCalledOnce()
      expect(runtime.start).toHaveBeenCalledOnce()
    })

    it("runs the real empty-population job to an inconclusive decision with the same tuple", async () => {
      const request = input()
      const result = await startExactHybridShadowEvaluation(db, request)
      const payload = runtime.start.mock
        .calls[0][1][0] as RecommendationShadowEvaluationJobInput
      expect(
        await runRecommendationShadowEvaluationJob(
          payload,
          result.dispatch.runId!,
        ),
      ).toMatchObject({
        status: "decided",
        decision: "inconclusive",
        processedRuns: 0,
      })
      const ledger = await db.workflowRun.findUniqueOrThrow({
        where: { id: result.dispatch.ledgerRunId },
      })
      expect(ledger).toMatchObject({
        status: "SUCCEEDED",
        runtimeRunId: result.dispatch.runId,
        details: {
          tuple: { minimumRuns: 2 },
          result: { decision: "inconclusive" },
        },
      })
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        { status: "terminal" },
      )
    })

    it("keeps generation fencing effective in the actual worker chain", async () => {
      const request = input()
      const result = await startExactHybridShadowEvaluation(db, request)
      const payload = runtime.start.mock
        .calls[0][1][0] as RecommendationShadowEvaluationJobInput
      await db.recommendationShadowEvaluation.update({
        where: { id: request.evaluationId },
        data: { generation: 2 },
      })
      expect(
        await runRecommendationShadowEvaluationJob(
          payload,
          result.dispatch.runId!,
        ),
      ).toMatchObject({
        status: "fenced",
        reason: "evaluation_generation_changed",
        processedRuns: 0,
      })
      expect(
        await db.workflowRun.findUniqueOrThrow({
          where: { id: result.dispatch.ledgerRunId },
        }),
      ).toMatchObject({
        status: "SKIPPED",
        details: {
          tuple: { expectedGeneration: 1 },
          result: { reason: "evaluation_generation_changed" },
        },
      })
    })

    it("rejects immutable tuple changes even after a terminal receipt", async () => {
      const request = input()
      const result = await startExactHybridShadowEvaluation(db, request)
      await db.workflowRun.update({
        where: { id: result.dispatch.ledgerRunId },
        data: { status: "FAILED" },
      })
      for (const change of [
        { minimumRuns: 1 },
        { requestedSampleSize: 4 },
        { windowStart: new Date(request.windowStart.getTime() + 1) },
        { windowEnd: new Date(request.windowEnd.getTime() - 1) },
      ]) {
        await expect(
          startExactHybridShadowEvaluation(db, { ...request, ...change }),
        ).rejects.toThrow("does not match")
      }
      expect(runtime.start).toHaveBeenCalledOnce()
    })

    it("refuses stale generation and expired sources before starting a prepared attempt", async () => {
      const request = input()
      await expect(
        startExactHybridShadowEvaluation(failingClient("intent"), request),
      ).rejects.toThrow()
      const dispatchInput = {
        evaluationId: request.evaluationId,
        expectedGeneration: 1,
        generatorKey: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
        minimumRuns: 2,
      }
      await db.recommendationShadowEvaluation.update({
        where: { id: request.evaluationId },
        data: { generation: 2 },
      })
      await expect(
        dispatchRecommendationShadowEvaluation(dispatchInput, {
          client: db,
          now: request.now,
        }),
      ).rejects.toThrow("stale or expired")
      await db.recommendationShadowEvaluation.update({
        where: { id: request.evaluationId },
        data: { generation: 1 },
      })
      await expect(
        dispatchRecommendationShadowEvaluation(dispatchInput, {
          client: db,
          now: new Date(request.now.getTime() + 30 * 86_400_000),
        }),
      ).rejects.toThrow("stale or expired")
      expect(runtime.start).not.toHaveBeenCalled()
    })

    it("does not retry legacy FAILED/null-runtime receipts", async () => {
      const request = input()
      const initial = await startExactHybridShadowEvaluation(db, request)
      await db.workflowRun.delete({
        where: { id: initial.dispatch.ledgerRunId },
      })
      const legacy = await db.workflowRun.create({
        data: {
          workflowKey: "recommendation-shadow-evaluation",
          subjectType: "recommendation-shadow-evaluation",
          subjectId: request.evaluationId,
          trigger: "SYSTEM",
          status: "FAILED",
          details: {
            evaluationId: request.evaluationId,
            expectedGeneration: 1,
            generatorKey: HYBRID_CANDIDATE_GENERATOR_SET_VERSION,
            minimumRuns: 2,
          },
        },
      })
      runtime.start.mockClear()
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        {
          status: "dispatch_uncertain",
          dispatch: { ledgerRunId: legacy.id, runId: null, queued: false },
        },
      )
      expect(runtime.start).not.toHaveBeenCalled()
      await db.workflowRun.update({
        where: { id: legacy.id },
        data: { runtimeRunId: "legacy-still-running" },
      })
      runtime.get.mockResolvedValueOnce({ status: "running" })
      expect(await startExactHybridShadowEvaluation(db, request)).toMatchObject(
        {
          status: "already_dispatched",
          dispatch: {
            state: "running",
            workflowStatus: "FAILED",
            runtimeStatus: "running",
          },
        },
      )
      expect(runtime.start).not.toHaveBeenCalled()
    })
  },
)
