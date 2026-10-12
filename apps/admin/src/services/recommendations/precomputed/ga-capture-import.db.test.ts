import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { PrismaClient, type Prisma } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { currentAdminMigrationSql } from "../current-schema.test-fixture"
import {
  canonicalGaCaptureJson,
  verifyGaCaptureFile,
} from "./ga-capture-artifact"
import { validArtifact, sha } from "./ga-capture-artifact.test-fixture"
import { deriveGaImportDestinationIdentity } from "./ga-capture-import-identity"
import { verifiedImportedGaCapture } from "./ga-capture-import"
import {
  createProtectedLocalGaCaptureStore,
  gaCaptureStorageKey,
} from "./ga-capture-store"
import { handleGaCaptureGet, handleGaCapturePost } from "./ga-capture-transport"
import { submitDurablePrecomputedRecommendation } from "./durable-build"
import {
  purgeExpiredPrecomputedGenerations,
  purgeRetiredGaCaptureArtifacts,
} from "./generation-retention"

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "destination-owned GA capture import on PostgreSQL",
  () => {
    let prisma: PrismaClient
    let admin: Client
    let root: string
    const suffix = randomUUID()
    const schema = `ga_import_${suffix.replaceAll("-", "")}`
    const videoId = `source-${suffix}`
    const originId = `origin-${suffix}`
    const destinationId = `destination-${suffix}`
    const originDigest = "a".repeat(64)
    const destinationDigest = "b".repeat(64)
    const sourceSetDigest = digest([videoId])
    const cutoff = new Date(Date.now() + 120_000).toISOString()
    const bearer = "Bearer preview-test-key"
    const candidatePoolDigest = "d".repeat(64)
    const attemptId = randomUUID()
    const dates = {
      requestedStart: "2022-06-21",
      requestedEnd: "2026-10-05",
      usableStart: "2022-08-08",
      usableEnd: "2026-10-05",
      requestedCoverageDigest: "2".repeat(64),
      usableCoverageDigest: "3".repeat(64),
    }

    beforeAll(async () => {
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      for (const migration of currentAdminMigrationSql)
        await admin.query(migration)
      const url = new URL(env.DATABASE_URL)
      url.searchParams.set("schema", schema)
      prisma = new PrismaClient<Prisma.PrismaClientOptions>({
        datasources: { db: { url: url.toString() } },
      })
      root = await mkdtemp(join(tmpdir(), "forge-ga-import-store-"))
      await prisma.language.create({
        data: {
          id: `language-${suffix}`,
          coreId: `language-${suffix}`,
          slug: "english",
        },
      })
      await prisma.muxVideo.create({
        data: { id: `mux-${suffix}`, playbackId: `playback-${suffix}` },
      })
      await prisma.video.create({
        data: { id: videoId, coreId: videoId, slug: videoId },
      })
      await prisma.videoLocale.create({
        data: {
          id: `locale-${suffix}`,
          videoId,
          locale: "en",
          status: "PUBLISHED",
          title: "Import source",
        },
      })
      await prisma.videoDub.create({
        data: {
          id: `dub-${suffix}`,
          coreId: `dub-${suffix}`,
          videoId,
          languageId: `language-${suffix}`,
          muxVideoId: `mux-${suffix}`,
          published: true,
        },
      })
    }, 120_000)

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
      if (root) await rm(root, { recursive: true, force: true })
    })

    it("copies verified bytes, binds once, and serves independently of the origin", async () => {
      const store = createProtectedLocalGaCaptureStore(root)
      let interruptDestinationPut = false
      const importStore = {
        ...store,
        async putIfAbsent(key: string, path: string, bytes: number) {
          if (interruptDestinationPut) {
            interruptDestinationPut = false
            throw new Error("injected_destination_put_interruption")
          }
          return store.putIfAbsent(key, path, bytes)
        },
      }
      const submit = (payload: unknown) =>
        submitDurablePrecomputedRecommendation(prisma, payload, bearer, {
          gaCaptureStore: store,
          gaImport: {
            store: importStore,
            objectBudgetBytes: 10_000_000,
            tempBudgetBytes: 10_000_000,
            tempReserveBytes: 0,
            availableTempBytes: async () => 10_000_000,
          },
        })
      async function start(
        generationId: string,
        inputDigest: string,
        protocolVersion: 3 | 4,
      ) {
        await submit({
          action: "start",
          protocolVersion,
          generationId,
          modelId: "gpt-6-astra",
          promptVersion: "ga-import-test-v1",
          inputDigest,
          sourceSetDigest,
          inputCutoff: cutoff,
          expectedSourceCount: 1,
          inputMode: "historical_analytics",
          inputSnapshotMode:
            protocolVersion === 3
              ? "ga_aggregate_capture_v1"
              : "observed_fenced",
          ...(protocolVersion === 4
            ? {
                executionAttempt: {
                  attemptId,
                  invocation: "start",
                  accountRef: "local-test-account",
                  backend: "codex_chatgpt_subscription",
                  billingBasis: "included_subscription",
                  authMethod: "chatgpt",
                  modelId: "gpt-6-astra",
                  identityObservedAt: new Date().toISOString(),
                  allowanceObservedAt: new Date().toISOString(),
                  weeklyRemainingPercent: 50,
                  fiveHour: { kind: "limited", remainingPercent: 50 },
                },
              }
            : {}),
        })
        const base = { generationId, generationInputDigest: inputDigest }
        await submit({
          action: "manifest",
          ...base,
          sourceVideoIds: [videoId],
          ...(protocolVersion === 4 ? { attemptId } : {}),
        })
        const probe = await submit({ action: "capacity_probe", ...base })
        await submit({
          action: "capacity",
          ...base,
          ...(protocolVersion === 4 ? { attemptId } : {}),
          measurement: {
            measuredAt: new Date().toISOString(),
            clusterSystemId: probe.clusterSystemId,
            observedDbBytes: probe.observedDbBytes,
            availableBytes: 20_000_000_000,
            reserveBytes: 5_000_000_000,
            projectedBytes: 1_000_000,
            sampleSourceCount: 1,
            sampleBytes: 100_000,
            source: "operator_verified_pgdata_df",
          },
        })
      }
      await start(originId, originDigest, 3)
      await start(destinationId, destinationDigest, 4)
      const destination =
        await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
          where: { id: destinationId },
        })
      const identity = await deriveGaImportDestinationIdentity(
        prisma,
        bearer,
        destination,
        { candidatePoolDigest, ...dates },
      )
      expect(
        await submit({
          action: "ga_import_status_v1",
          generationId: destinationId,
          generationInputDigest: destinationDigest,
        }),
      ).toEqual({ version: "ga_capture_import_v1", state: "absent" })
      const prepared = await submit({
        action: "ga_import_prepare_v1",
        generationId: destinationId,
        generationInputDigest: destinationDigest,
        attemptId,
        candidatePoolDigest,
        ...dates,
      })
      expect(prepared).toMatchObject({
        state: "prepared",
        destination: identity,
      })
      expect(await verifiedImportedGaCapture(prisma, destination)).toBeNull()

      const original = validArtifact({
        generationId: originId,
        generationInputDigest: originDigest,
        sourceSetDigest,
        inputCutoff: cutoff,
        physicalHttpAttempts: 0,
        physicalSucceededCalls: 0,
      })
      const originalHeaderLength = original.readUInt32BE(8)
      const header = JSON.parse(
        original.subarray(12, 12 + originalHeaderLength).toString(),
      ) as Record<string, unknown>
      Object.assign(header, {
        selectedCorpusDigest: identity.selectedCorpusDigest,
        candidatePoolDigest: identity.candidatePoolDigest,
        routeMappingDigest: identity.routeMappingDigest,
        sourcePatternTableDigest: identity.sourcePatternTableDigest,
        querySpecDigest: identity.querySpecDigest,
      })
      const blocks = header.blocks as Array<{
        compressedBytes: number
        compressedSha256: string
        rawBytes: number
        rawSha256: string
      }>
      const firstTwoBytes =
        blocks[0]!.compressedBytes + blocks[1]!.compressedBytes
      const pages = original.subarray(
        12 + originalHeaderLength,
        12 + originalHeaderLength + firstTwoBytes,
      )
      const escapedSlug = videoId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
      const pattern = `/watch/${escapedSlug}\\.html(?:/[a-z0-9-]+\\.html)?`
      const indexRaw = Buffer.from(
        canonicalGaCaptureJson({
          sourcePatterns: [pattern],
          pagesBySourcePattern: [[]],
        }),
      )
      const indexCompressed = gzipSync(indexRaw)
      blocks[2] = {
        ...blocks[2]!,
        compressedBytes: indexCompressed.length,
        compressedSha256: sha(indexCompressed),
        rawBytes: indexRaw.length,
        rawSha256: sha(indexRaw),
      }
      const headerBytes = Buffer.from(canonicalGaCaptureJson(header))
      const prefix = Buffer.alloc(12)
      prefix.write("FORGEGA1")
      prefix.writeUInt32BE(headerBytes.length, 8)
      const body = Buffer.concat([prefix, headerBytes, pages, indexCompressed])
      const verifyPath = join(root, "verify-import-fixture.bin")
      await writeFile(verifyPath, body)
      await verifyGaCaptureFile(verifyPath, sha(body), body.length)
      const uploaded = await handleGaCapturePost(
        prisma,
        new Request("http://localhost/internal/ga-capture", {
          method: "POST",
          headers: {
            authorization: bearer,
            "content-type": "application/vnd.forge.ga-capture-v1",
            "x-forge-generation-id": originId,
            "x-forge-input-digest": originDigest,
            "x-forge-artifact-sha256": sha(body),
            "content-length": String(body.length),
          },
          body,
        }),
        store,
      )
      expect(
        uploaded.status,
        JSON.stringify(await uploaded.clone().json()),
      ).toBe(201)
      const { snapshotRef } = (await uploaded.json()) as {
        snapshotRef: Record<string, unknown>
      }
      await submit({
        action: "history_qualification",
        generationId: originId,
        generationInputDigest: originDigest,
        qualification: {
          ...(header.baseQualification as Record<string, unknown>),
          snapshotRef,
        },
      })
      const probe = await submit({
        action: "ga_import_origin_probe_v1",
        originGenerationId: originId,
      })
      expect(probe).toMatchObject({ origin: { artifactSha256: sha(body) } })
      const copyRequest = {
        action: "ga_import_copy_bind_v1",
        generationId: destinationId,
        generationInputDigest: destinationDigest,
        attemptId,
        preparedDigest: prepared.preparedDigest,
        originGenerationId: originId,
        originArtifactSha256: sha(body),
        originProofDigest: probe.originProofDigest,
      }
      interruptDestinationPut = true
      await expect(submit(copyRequest)).rejects.toThrow(
        "injected_destination_put_interruption",
      )
      expect(
        await prisma.recommendationPrecomputedGaCaptureImport.findUniqueOrThrow(
          {
            where: { destinationGenerationId: destinationId },
          },
        ),
      ).toMatchObject({ state: "copying" })
      expect(await submit(copyRequest)).toMatchObject({
        state: "copying",
        replay: true,
      })
      await prisma.recommendationPrecomputedGaCaptureImport.update({
        where: { destinationGenerationId: destinationId },
        data: { copyLeaseExpiresAt: new Date(Date.now() - 1_000) },
      })
      const bound = await submit(copyRequest)
      expect(bound).toMatchObject({ state: "bound", replay: false })
      const binding = bound.importBinding as { bindingDigest: string }
      expect(
        await prisma.recommendationPrecomputedHistoryCall.count({
          where: { generationId: destinationId },
        }),
      ).toBe(0)
      expect(
        await verifiedImportedGaCapture(
          prisma,
          await prisma.recommendationPrecomputedGeneration.findUniqueOrThrow({
            where: { id: destinationId },
          }),
        ),
      ).toMatchObject({ bindingDigest: binding.bindingDigest })
      expect(
        await submit({
          action: "ga_import_status_v1",
          generationId: destinationId,
          generationInputDigest: destinationDigest,
        }),
      ).toMatchObject({ state: "bound", importBinding: bound.importBinding })

      await prisma.recommendationPrecomputedGeneration.update({
        where: { id: originId },
        data: { status: "failed", failedAt: new Date("2020-01-01T00:00:00Z") },
      })
      for (let page = 0; page < 20; page += 1) {
        await prisma.$transaction((tx) =>
          purgeExpiredPrecomputedGenerations(tx, new Date(), 1),
        )
        if (
          !(await prisma.recommendationPrecomputedGeneration.findUnique({
            where: { id: originId },
          }))
        )
          break
      }
      expect(
        await prisma.recommendationPrecomputedGeneration.findUnique({
          where: { id: originId },
        }),
      ).toBeNull()
      expect(
        await purgeRetiredGaCaptureArtifacts(
          prisma,
          new Date(Date.now() + 31 * 60_000),
          10,
          store,
        ),
      ).toMatchObject({ deleted: 1 })
      const retiredOriginStream = await store.open(
        gaCaptureStorageKey(originId, sha(body)),
      )
      await expect(
        retiredOriginStream[Symbol.asyncIterator]().next(),
      ).rejects.toThrow()
      expect(
        await submit({
          action: "ga_import_status_v1",
          generationId: destinationId,
          generationInputDigest: destinationDigest,
        }),
      ).toMatchObject({ state: "bound", importBinding: bound.importBinding })
      const downloaded = await handleGaCaptureGet(
        prisma,
        new Request("http://localhost/internal/ga-capture", {
          headers: {
            authorization: bearer,
            "x-forge-generation-id": destinationId,
            "x-forge-input-digest": destinationDigest,
          },
        }),
        store,
      )
      expect(downloaded.status).toBe(200)
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(body)
    })
  },
)
