import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { createServer, type Server, type ServerResponse } from "node:http"
import { promisify } from "node:util"
import { setTimeout as sleep } from "node:timers/promises"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { createSchema, createYoga } from "graphql-yoga"
import type Redis from "ioredis"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"
import { RecommendationEpisodeService } from "@/services/recommendations/episode.service"
import { RecommendationPlaybackService } from "@/services/recommendations/playback.service"
import {
  createRecommendationTokenService,
  parseRecommendationKeyring,
} from "@/services/recommendations/token.service"

const environment = vi.hoisted(() => ({}) as typeof env)
vi.mock("@/config/env", async (original) => {
  const config = await original<typeof import("@/config/env")>()
  Object.assign(environment, config.env, {
    NODE_ENV: "production",
    REDIS_HOST: "127.0.0.1",
    REDIS_PORT: undefined,
    REDIS_PASSWORD: undefined,
  })
  return { env: environment }
})
vi.mock("@/app/api/graphql/route", async () => {
  await import("./rate-limit")
  return {}
})

const dockerExec = promisify(execFile)
const docker = async (...args: string[]) =>
  (await dockerExec("docker", args, { timeout: 30_000 })).stdout.trim()
const PRELOAD_ENTRIES = Symbol.for("forge.next.preloadEntries")
const runtime = globalThis as typeof globalThis & {
  [PRELOAD_ENTRIES]?: Promise<void>
}

async function until(predicate: () => boolean, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error("fixture wait expired")
    await sleep(10)
  }
}

// Opt-in only. Every container, port and database is created here, never selected
// from DATABASE_URL or an existing service. The reduced schema isolates the real
// production limiter + playback services; it does not exercise auth or Next.
describe.skipIf(
  env.RECOMMENDATION_DB_TEST !== "1" || env.RECOMMENDATION_REDIS_TEST !== "1",
)("production limiter recovery with owned Redis and PostgreSQL", () => {
  const suffix = randomUUID()
  const redisName = `feat464-redis-${suffix}`
  const pgName = `feat464-pg-${suffix}`
  const created: string[] = []
  let redis: Redis
  let sql: Client
  let prisma: PrismaClient
  let server: Server
  let url: string
  let resolverCalls = 0
  let admissionCompletions = 0
  let dropAcknowledgement = false
  let episodeId: string
  let capability: string
  const occurredAt = new Date().toISOString()
  const caller = {
    id: null,
    role: "CONSUMER_BEARER" as const,
    rateLimitBucketKey: "local-recovery-fixture",
  }
  const originalPreload = runtime[PRELOAD_ENTRIES]
  const observations: Record<string, unknown>[] = []
  const graphqlErrors: unknown[] = []

  async function port(name: string, containerPort: string) {
    const binding = await docker("port", name, containerPort)
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) {
      throw new Error("fixture must bind only to loopback")
    }
    return Number(binding.split(":")[1])
  }

  function request(eventId: string, signal?: AbortSignal) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query:
          "mutation Record($id: String!) { recordSemanticRecommendationPlayback(eventId: $id) { eventId status sequence } }",
        variables: { id: eventId },
      }),
      signal,
    })
  }

  const factCount = (eventId: string) =>
    prisma.recommendationPlaybackFact.count({ where: { episodeId, eventId } })

  beforeAll(async () => {
    vi.stubEnv("NEXT_PHASE", "")
    const reservation = createServer()
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    )
    const binding = reservation.address()
    if (!binding || typeof binding === "string")
      throw new Error("no Redis fixture port")
    await new Promise<void>((resolve) => reservation.close(() => resolve()))
    await docker(
      "run",
      "-d",
      "--name",
      redisName,
      "--label",
      "forge.diagnostic=feat-464",
      "-p",
      `127.0.0.1:${binding.port}:6379`,
      "redis:8.10.2-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
      "--protected-mode",
      "no",
    )
    created.push(redisName)
    Object.assign(environment, {
      REDIS_PORT: await port(redisName, "6379/tcp"),
    })
    const { getRedisClient } = await import("@/infra/redis")
    redis = getRedisClient()!
    await until(() => redis.status === "ready")
    const password = randomBytes(24).toString("hex")
    await docker(
      "run",
      "-d",
      "--name",
      pgName,
      "--label",
      "forge.diagnostic=feat-464",
      "-p",
      "127.0.0.1::5432",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=diagnostic",
      "pgvector/pgvector:pg18",
    )
    created.push(pgName)
    const connectionString = `postgresql://postgres:${password}@127.0.0.1:${await port(pgName, "5432/tcp")}/diagnostic`
    for (let attempt = 0; ; attempt++) {
      try {
        await docker(
          "exec",
          pgName,
          "pg_isready",
          "-h",
          "127.0.0.1",
          "-U",
          "postgres",
        )
        break
      } catch (error) {
        if (attempt >= 60) throw error
        await sleep(100)
      }
    }
    sql = new Client({ connectionString })
    await sql.connect()
    await sql.query("CREATE EXTENSION vector")
    const migrations = new URL("../../../prisma/migrations/", import.meta.url)
    for (const name of readdirSync(migrations).sort()) {
      const ordinal = Number(name.slice(0, 4))
      if (
        (ordinal >= 52 && ordinal <= 82 && name.includes("recommendation")) ||
        name === "0082_user_recommendation_identity"
      ) {
        await sql.query(
          readFileSync(new URL(`${name}/migration.sql`, migrations), "utf8"),
        )
      }
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
    const keyring = parseRecommendationKeyring(
      JSON.stringify({
        keys: [
          {
            kid: "local-recovery",
            status: "active",
            key: randomBytes(32).toString("base64url"),
          },
        ],
      }),
    )
    const tokenService = {
      activeKid: keyring.active.kid,
      ...createRecommendationTokenService({
        keyring,
        readRevokedKids: async () => [],
      }),
    }
    const episodes = new RecommendationEpisodeService({
      prisma,
      tokenService,
    })
    const context = await episodes.issueContext({
      caller,
      sessionDigest: "a".repeat(64),
      mediaId: "recovery-media",
      discoverySource: "direct",
      provenance: { entry: "canonical" },
    })
    const claim = await episodes.claim({
      caller,
      sessionDigest: "a".repeat(64),
      mediaId: "recovery-media",
      claimNonce: context.claimNonce,
    })
    episodeId = claim.episodeId
    capability = claim.capability
    const playback = new RecommendationPlaybackService({
      prisma,
      tokenService,
    })
    const { rateLimitPlugin } = await import("./rate-limit")
    const yoga = createYoga<{ res: ServerResponse }>({
      graphqlEndpoint: "/api/graphql",
      fetchAPI: { Response },
      logging: {
        debug() {},
        info() {},
        warn() {},
        error: (...errors: unknown[]) => {
          graphqlErrors.push(...errors)
        },
      },
      maskedErrors: { isDev: false },
      context: ({ request, res }) => ({ request, res, user: caller }),
      plugins: [
        {
          ...rateLimitPlugin,
          async onExecute(payload) {
            try {
              return await rateLimitPlugin.onExecute?.(payload)
            } finally {
              admissionCompletions++
            }
          },
        } satisfies typeof rateLimitPlugin,
      ],
      schema: createSchema({
        typeDefs: `type Query { fixture: Boolean! }
            type Receipt { eventId: String!, status: String!, sequence: Int! }
            type Mutation { recordSemanticRecommendationPlayback(eventId: String!): [Receipt!]! }`,
        resolvers: {
          Query: { fixture: () => true },
          Mutation: {
            recordSemanticRecommendationPlayback: async (
              _root: unknown,
              args: { eventId: string },
              context: { res: ServerResponse },
            ) => {
              resolverCalls++
              const receipts = await playback.record({
                caller,
                contractVersion: "recommendation-evidence-v1",
                capability,
                episodeId,
                sessionDigest: "a".repeat(64),
                mediaId: "recovery-media",
                events: [
                  {
                    eventId: args.eventId,
                    kind: "playback_progress",
                    occurredAt,
                    payload: {
                      positionSeconds: 20,
                      durationSeconds: 120,
                      progress: 1 / 6,
                      wallElapsedMilliseconds: 20_000,
                    },
                  },
                ],
              })
              if (dropAcknowledgement) {
                dropAcknowledgement = false
                context.res.destroy()
              }
              return receipts
            },
          },
        },
      }),
    })
    server = createServer(yoga)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("no fixture port")
    url = `http://127.0.0.1:${address.port}/api/graphql`
    runtime[PRELOAD_ENTRIES] = Promise.resolve()
    observations.push({
      redisVersion: (await redis.info("server")).match(
        /redis_version:([^\r]+)/,
      )?.[1],
    })
  }, 60_000)

  afterAll(async () => {
    // Always unpause owned services before teardown, including failed assertions.
    if (created.includes(redisName))
      await docker("unpause", redisName).catch(() => {})
    const cleanupErrors: unknown[] = []
    try {
      server?.closeAllConnections()
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()))
      redis?.disconnect()
      await prisma?.$disconnect()
      await sql?.end()
    } catch (error) {
      cleanupErrors.push(error)
    } finally {
      for (const name of created.reverse()) {
        await docker("rm", "-f", "-v", name).catch((error: unknown) => {
          cleanupErrors.push(error)
        })
      }
      if (originalPreload) runtime[PRELOAD_ENTRIES] = originalPreload
      else delete runtime[PRELOAD_ENTRIES]
      vi.unstubAllEnvs()
      console.info("RECOVERY_OBSERVATIONS", JSON.stringify(observations))
    }
    if (cleanupErrors.length > 0)
      throw new AggregateError(cleanupErrors, "owned fixture cleanup failed")
  }, 60_000)

  it("accepts a healthy control through the real limiter and stores one fact", async () => {
    const response = await request("healthy")
    expect(response.status).toBe(200)
    expect(
      (await response.json()).data.recordSemanticRecommendationPlayback[0]
        .status,
    ).toBe("accepted")
    expect(await factCount("healthy")).toBe(1)
  })

  it.each([1, 2, 3])(
    "fails before writes during restart %i, then reconnects without restarting Admin",
    async (round) => {
      const eventId = `restart-${round}`
      await docker("stop", "--time", "0", redisName)
      await until(() => redis.status !== "ready")
      const initialCalls = resolverCalls
      const initialErrors = graphqlErrors.length
      const failures: { status: number; elapsedMs: number }[] = []
      const began = performance.now()
      for (const delay of [0, 100, 200]) {
        await sleep(delay)
        const response = await request(eventId)
        expect(response.status).toBe(500)
        const body = await response.json()
        expect(body.errors[0].message).toBe("Unexpected error.")
        failures.push({
          status: response.status,
          elapsedMs: Math.round(performance.now() - began),
        })
      }
      expect(resolverCalls).toBe(initialCalls)
      expect(graphqlErrors.slice(initialErrors)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              "Stream isn't writeable and enableOfflineQueue options is false",
          }),
        ]),
      )
      expect(await factCount(eventId)).toBe(0)
      const { GET } = await import("@/app/api/health/route")
      expect((await GET()).status).toBe(503)
      const restarted = performance.now()
      await docker("start", redisName)
      expect(await port(redisName, "6379/tcp")).toBe(environment.REDIS_PORT)
      await until(() => redis.status === "ready")
      expect((await GET()).status).toBe(200)
      const recoveryMs = Math.round(performance.now() - restarted)
      const response = await request(eventId)
      expect(response.status).toBe(200)
      expect(
        (await response.json()).data.recordSemanticRecommendationPlayback[0]
          .status,
      ).toBe("accepted")
      const replay = await request(eventId)
      expect(
        (await replay.json()).data.recordSemanticRecommendationPlayback[0]
          .status,
      ).toBe("replay")
      expect(await factCount(eventId)).toBe(1)
      observations.push({
        scenario: "restart",
        round,
        failures,
        recoveryMs,
        facts: 1,
      })
    },
    25_000,
  )

  it("waits through a brief silent Redis stall within the admission budget", async () => {
    await docker("pause", redisName)
    const initialCalls = resolverCalls
    const began = performance.now()
    const pending = request("short-stall")
    try {
      await sleep(100)
      expect(redis.status).toBe("ready")
      expect(resolverCalls).toBe(initialCalls)
      expect(await factCount("short-stall")).toBe(0)
    } finally {
      await docker("unpause", redisName)
    }
    const response = await pending
    expect(response.status).toBe(200)
    expect(
      (await response.json()).data.recordSemanticRecommendationPlayback[0]
        .status,
    ).toBe("accepted")
    observations.push({
      scenario: "short-stall",
      elapsedMs: Math.round(performance.now() - began),
      facts: await factCount("short-stall"),
    })
  }, 15_000)

  it("rejects stalled admission before the caller deadline and never commits after recovery", async () => {
    await docker("pause", redisName)
    const initialCalls = resolverCalls
    const began = performance.now()
    const pending = request("aborted-stall", AbortSignal.timeout(3_000))
    try {
      expect((await pending).status).toBe(500)
      const admissionElapsedMs = Math.round(performance.now() - began)
      expect(admissionElapsedMs).toBeLessThan(2_000)
      expect(redis.status).toBe("ready")
      expect(resolverCalls).toBe(initialCalls)
      expect(await factCount("aborted-stall")).toBe(0)
      const { GET } = await import("@/app/api/health/route")
      expect((await GET()).status).toBe(503)
      observations.push({
        scenario: "bounded-stall",
        admissionElapsedMs,
        healthStatus: 503,
        factsBeforeRecovery: 0,
      })
    } finally {
      await docker("unpause", redisName)
    }
    // PING queues behind the timed-out GET, proving that late Redis work drained.
    await redis.ping()
    expect(resolverCalls).toBe(initialCalls)
    expect(await factCount("aborted-stall")).toBe(0)
    const response = await request("aborted-stall")
    expect(
      (await response.json()).data.recordSemanticRecommendationPlayback[0]
        .status,
    ).toBe("accepted")
    expect(await factCount("aborted-stall")).toBe(1)
  }, 15_000)

  it("replays identical facts after a real post-commit socket loss without duplication", async () => {
    dropAcknowledgement = true
    await expect(request("lost-ack")).rejects.toThrow()
    expect(await factCount("lost-ack")).toBe(1)
    const response = await request("lost-ack")
    expect(
      (await response.json()).data.recordSemanticRecommendationPlayback[0]
        .status,
    ).toBe("replay")
    expect(await factCount("lost-ack")).toBe(1)
    observations.push({ scenario: "lost-ack", facts: 1, receipt: "replay" })
  })

  it("does not execute after a caller disconnects before admission recovers within its deadline", async () => {
    await docker("pause", redisName)
    const get = vi.spyOn(redis, "get")
    const controller = new AbortController()
    const initialCalls = resolverCalls
    const initialCompletions = admissionCompletions
    const began = performance.now()
    try {
      const rejected = expect(
        request("early-disconnect", controller.signal),
      ).rejects.toThrow()
      await until(() => get.mock.calls.length > 0)
      controller.abort()
      await rejected
      expect(resolverCalls).toBe(initialCalls)
      await sleep(50)
    } finally {
      controller.abort()
      get.mockRestore()
      await docker("unpause", redisName)
    }
    await redis.ping()
    await until(() => admissionCompletions > initialCompletions)
    const recoveryElapsedMs = Math.round(performance.now() - began)
    // Otherwise the store's 500 ms timeout could mask a missing abort fence.
    expect(recoveryElapsedMs).toBeLessThan(500)
    expect(resolverCalls).toBe(initialCalls)
    expect(await factCount("early-disconnect")).toBe(0)
    observations.push({
      scenario: "early-disconnect",
      recoveryElapsedMs,
      facts: 0,
    })
  }, 15_000)
})
