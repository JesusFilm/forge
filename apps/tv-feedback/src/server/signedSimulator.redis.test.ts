import { generateKeyPairSync, randomUUID } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import Redis from "ioredis"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const fixture = vi.hoisted(() => ({ connection: null as Redis | null }))
vi.mock("./redis", () => ({
  redis: () => {
    if (!fixture.connection) throw new Error("Test Redis unavailable")
    return fixture.connection
  },
  key: (kind: string, id: string) => `test-feedback:${kind}:${id}`,
}))
import {
  activeGrantForSession,
  beginSubmission,
  claimGrant,
  createChallenge,
  createSignedSimulatorGrant,
  finishSubmission,
  issueGrant,
  reserveUpload,
  type Grant,
  type Session,
} from "./feedbackState"
import { signedSimulatorConfig } from "./signedSimulator"

// Explicit opt-in binary; never uses REDIS_URL, staging or a production database.
describe.skipIf(!process.env.FEEDBACK_TEST_REDIS_BINARY)(
  "signed simulator quotas in real isolated Redis",
  () => {
    let directory = "",
      process: ChildProcess,
      keyId: string
    const day = new Date().toISOString().slice(0, 10)
    const session = (grantId = randomUUID()): Session => ({
      id: randomUUID(),
      secretHash: "test-only",
      grantId,
      expiresAt: Date.now() + 600000,
      admittedBytes: 0,
      images: 0,
      videos: 0,
      reservations: 0,
    })
    beforeAll(async () => {
      directory = await mkdtemp(path.join(tmpdir(), "tv-feedback-redis-"))
      const socket = path.join(directory, "redis.sock")
      process = spawn(
        globalThis.process.env.FEEDBACK_TEST_REDIS_BINARY!,
        [
          "--port",
          "0",
          "--unixsocket",
          socket,
          "--unixsocketperm",
          "700",
          "--save",
          "",
          "--appendonly",
          "no",
          "--dir",
          directory,
        ],
        { stdio: "ignore" },
      )
      for (let count = 0; count < 100; count++) {
        if (
          await stat(socket)
            .then(() => true)
            .catch(() => false)
        )
          break
        if (process.exitCode !== null) throw new Error("Isolated Redis exited")
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      fixture.connection = new Redis(socket, {
        lazyConnect: true,
        retryStrategy: () => null,
      })
      await fixture.connection.connect()
      const { publicKey } = generateKeyPairSync("ed25519")
      vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "true")
      vi.stubEnv(
        "FEEDBACK_SIMULATOR_PUBLIC_KEY",
        publicKey.export({ type: "spki", format: "pem" }).toString(),
      )
      vi.stubEnv(
        "FEEDBACK_SIMULATOR_AUDIENCE",
        "https://web-staging-920a.up.railway.app",
      )
      vi.stubEnv(
        "FEEDBACK_BASE_URL",
        "https://web-staging-920a.up.railway.app/tv",
      )
      keyId = signedSimulatorConfig()!.keyId
    }, 10000)
    afterAll(async () => {
      await fixture.connection?.quit()
      fixture.connection = null
      if (process && process.exitCode === null) {
        const exited = new Promise((resolve) => process.once("exit", resolve))
        process.kill("SIGTERM")
        await exited
      }
      if (directory) await rm(directory, { recursive: true, force: true })
      vi.unstubAllEnvs()
    })
    async function signed(tokenId: string) {
      const current = session()
      const grant = await createSignedSimulatorGrant(current, {
        tokenId,
        expiresAt: current.expiresAt,
        signingKeyId: keyId,
      })
      return { current, grant }
    }
    async function normal(installationId: string) {
      const current = session(),
        challengeId = randomUUID(),
        secret = randomUUID()
      const grant: Grant = {
        id: current.grantId,
        installationId,
        day,
        reference: "NATIVE-TEST",
        expiresAt: current.expiresAt,
      }
      await createChallenge(challengeId, "fixture-nonce", day, 600)
      expect(
        await issueGrant(
          challengeId,
          installationId,
          "fixture-fingerprint",
          day,
          grant,
          secret,
        ),
      ).toBe("ok")
      expect(await claimGrant(secret, current)).toHaveProperty("grant")
      return { current, grant }
    }
    it("accepts more than three simulator reports and preserves single-report idempotency", async () => {
      const tokenId = randomUUID()
      for (let count = 0; count < 6; count++) {
        const { current, grant } = await signed(tokenId),
          reportId = randomUUID()
        const result = await beginSubmission(
          current.id,
          reportId,
          "payload",
          randomUUID(),
          [],
        )
        expect(result).toHaveProperty("created", true)
        if (!("submission" in result))
          throw new Error("Expected authorized submission")
        await finishSubmission(
          result.submission,
          grant.day,
          grant.installationId,
          "delivered",
          "fixture-issue",
        )
        expect(
          await beginSubmission(
            current.id,
            reportId,
            "payload",
            randomUUID(),
            [],
          ),
        ).toHaveProperty("created", false)
        expect(
          await beginSubmission(
            current.id,
            randomUUID(),
            "other",
            randomUUID(),
            [],
          ),
        ).toEqual({ error: "grant_required" })
      }
    })
    it("keeps the three-report daily limit for native grants", async () => {
      const installationId = randomUUID()
      const entries = []
      for (let count = 0; count < 4; count++)
        entries.push(await normal(installationId))
      for (const [index, { current, grant }] of entries.entries()) {
        const result = await beginSubmission(
          current.id,
          randomUUID(),
          "payload",
          randomUUID(),
          [],
        )
        if (index === 3) {
          expect(result).toEqual({ error: "daily_limit" })
          continue
        }
        expect(result).toHaveProperty("created", true)
        if (!("submission" in result))
          throw new Error("Expected native submission")
        await finishSubmission(
          result.submission,
          grant.day,
          grant.installationId,
          "delivered",
          "fixture-issue",
        )
      }
    })
    it("resets simulator report byte budgets per session while retaining upload limits", async () => {
      const tokenId = randomUUID()
      for (let count = 0; count < 2; count++) {
        const { current } = await signed(tokenId)
        expect(
          await reserveUpload(current.id, {
            kind: "video",
            filename: "sample.mp4",
            type: "video/mp4",
            size: 40 * 1024 * 1024,
          }),
        ).toHaveProperty("uploadId")
        expect(
          await reserveUpload(current.id, {
            kind: "video",
            filename: "another.mp4",
            type: "video/mp4",
            size: 1024,
          }),
        ).toEqual({ error: "quota_exceeded" })
      }
    })
    it("invalidates existing simulator grants when signing is disabled without affecting native grants", async () => {
      const sim = await signed(randomUUID()),
        native = await normal(randomUUID())
      expect(await activeGrantForSession(sim.current.id)).not.toBeNull()
      vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "false")
      expect(await activeGrantForSession(sim.current.id)).toBeNull()
      expect(await activeGrantForSession(native.current.id)).not.toBeNull()
      vi.stubEnv("FEEDBACK_SIMULATOR_SIGNED_ENABLED", "true")
    })
  },
)
