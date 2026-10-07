import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type PrismaClient } from "@prisma/client"
import { isValidMastraRecommendationIngestBearer } from "@/auth/mastra-ingest-bearer"
import { GaCaptureError } from "./ga-capture-error"
import {
  GA_CAPTURE_CONTENT_TYPE,
  GA_CAPTURE_MAX_BYTES,
  canonicalGaCaptureJson,
  gaCaptureSnapshotRefSchema,
  verifyGaCaptureFile,
  type GaCaptureSnapshotRef,
} from "./ga-capture-artifact"
import { gaCaptureStorageKey, type GaCaptureStore } from "./ga-capture-store"

const HEX = /^[a-f0-9]{64}$/u

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function identityHeaders(request: Request) {
  const generationId = request.headers.get("x-forge-generation-id")
  const generationInputDigest = request.headers.get("x-forge-input-digest")
  if (
    !generationId ||
    generationId.length > 191 ||
    !generationInputDigest ||
    !HEX.test(generationInputDigest)
  )
    return null
  return { generationId, generationInputDigest }
}

async function verifiedGeneration(
  prisma: PrismaClient,
  identity: { generationId: string; generationInputDigest: string },
) {
  const generation =
    await prisma.recommendationPrecomputedGeneration.findUnique({
      where: { id: identity.generationId },
      select: {
        id: true,
        inputDigest: true,
        sourceSetDigest: true,
        inputCutoff: true,
        inputMode: true,
        inputSnapshotMode: true,
        protocolVersion: true,
        status: true,
        manifestCommittedAt: true,
        capacityPreflight: true,
        historicalQualification: true,
      },
    })
  if (
    !generation ||
    generation.inputDigest !== identity.generationInputDigest ||
    generation.protocolVersion !== 3 ||
    generation.inputMode !== "historical_analytics" ||
    generation.inputSnapshotMode !== "ga_aggregate_capture_v1"
  )
    return null
  return generation
}

async function streamToProtectedFile(
  stream: ReadableStream<Uint8Array> | null,
  expectedBytes: number,
  expectedSha256: string,
  path: string,
) {
  if (!stream) throw new GaCaptureError("Missing GA capture body")
  const file = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  )
  const reader = stream.getReader()
  const hash = createHash("sha256")
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > expectedBytes || bytes > GA_CAPTURE_MAX_BYTES)
        throw new GaCaptureError("GA capture body is oversized")
      await file.writeFile(chunk.value)
      hash.update(chunk.value)
    }
    if (bytes !== expectedBytes || hash.digest("hex") !== expectedSha256)
      throw new GaCaptureError("GA capture body digest/length differs")
    await file.sync()
  } finally {
    await reader.cancel().catch(() => undefined)
    await file.close()
  }
}

async function verifyStoredObject(
  store: GaCaptureStore,
  key: string,
  sha256: string,
  byteLength: number,
) {
  const stream = await store.open(key)
  const hash = createHash("sha256")
  let size = 0
  try {
    for await (const chunk of stream) {
      size += chunk.byteLength
      if (size > byteLength || size > GA_CAPTURE_MAX_BYTES)
        throw new GaCaptureError("Stored GA capture is oversized")
      hash.update(chunk)
    }
  } finally {
    stream.destroy()
  }
  if (size !== byteLength || hash.digest("hex") !== sha256)
    throw new GaCaptureError("Stored GA capture differs from sealed identity")
}

export async function handleGaCapturePost(
  prisma: PrismaClient,
  request: Request,
  store: GaCaptureStore,
): Promise<Response> {
  if (
    !isValidMastraRecommendationIngestBearer(
      request.headers.get("authorization"),
    )
  )
    return error("Authorization required", 401)
  if (request.headers.get("content-type") !== GA_CAPTURE_CONTENT_TYPE)
    return error("Invalid GA capture content type", 415)
  const identity = identityHeaders(request)
  const sha256 = request.headers.get("x-forge-artifact-sha256")
  const declared = request.headers.get("content-length")
  const byteLength =
    declared && /^\d+$/u.test(declared) ? Number(declared) : NaN
  if (
    !identity ||
    !sha256 ||
    !HEX.test(sha256) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 13 ||
    byteLength > GA_CAPTURE_MAX_BYTES
  )
    return error("Invalid or oversized GA capture declaration", 413)
  const generation = await verifiedGeneration(prisma, identity)
  if (
    !generation ||
    generation.status !== "incomplete" ||
    !generation.manifestCommittedAt ||
    (generation.capacityPreflight as { status?: string } | null)?.status !==
      "passed"
  )
    return error("GA capture generation is unavailable", 409)
  const bound = generation.historicalQualification as {
    snapshotRef?: { artifactSha256?: string }
  } | null
  if (
    bound?.snapshotRef?.artifactSha256 &&
    bound.snapshotRef.artifactSha256 !== sha256
  )
    return error("GA capture is already sealed differently", 409)
  const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-upload-"))
  const temp = join(root, "capture.bin")
  try {
    await streamToProtectedFile(request.body, byteLength, sha256, temp)
    const verified = await verifyGaCaptureFile(temp, sha256, byteLength)
    const header = verified.header
    if (
      header.generationId !== generation.id ||
      header.generationInputDigest !== generation.inputDigest ||
      header.sourceSetDigest !== generation.sourceSetDigest ||
      header.inputCutoff !== generation.inputCutoff.toISOString()
    )
      return error("GA capture generation identity differs", 409)
    const storageKey = gaCaptureStorageKey(generation.id, sha256)
    // Register before object creation. A process death after the S3 write then
    // leaves a bounded cleanup handle rather than an undiscoverable object.
    let receipt: { storageKey: string; artifactBytes: bigint }
    try {
      await prisma.recommendationPrecomputedGaCaptureArtifact.createMany({
        data: [
          {
            generationId: generation.id,
            artifactSha256: sha256,
            storageKey,
            artifactBytes: BigInt(byteLength),
          },
        ],
        skipDuplicates: true,
      })
      receipt =
        await prisma.recommendationPrecomputedGaCaptureArtifact.findUniqueOrThrow(
          {
            where: {
              generationId_artifactSha256: {
                generationId: generation.id,
                artifactSha256: sha256,
              },
            },
          },
        )
    } catch {
      return error("Private GA capture receipt unavailable", 502)
    }
    if (
      receipt.storageKey !== storageKey ||
      receipt.artifactBytes !== BigInt(byteLength)
    )
      return error("GA capture upload receipt differs", 409)
    let state: "created" | "exists"
    try {
      state = await store.putIfAbsent(storageKey, temp, byteLength)
      if (state === "exists")
        await verifyStoredObject(store, storageKey, sha256, byteLength)
    } catch {
      return error("Private GA capture storage unavailable or differs", 502)
    }
    const scalars: Partial<typeof header> = { ...header }
    delete scalars.blocks
    delete scalars.baseQualification
    const snapshotRef = gaCaptureSnapshotRefSchema.parse({
      ...scalars,
      storageKey,
      artifactSha256: sha256,
      artifactBytes: byteLength,
      headerSha256: verified.headerSha256,
    })
    return Response.json(
      { snapshotRef },
      { status: state === "created" ? 201 : 200 },
    )
  } catch {
    return error("GA capture verification or private storage failed", 409)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Full object check once before immutable qualification commit. */
export async function verifyBoundGaCapture(
  reference: GaCaptureSnapshotRef,
  store: GaCaptureStore,
) {
  const root = await mkdtemp(join(tmpdir(), "forge-ga-capture-verify-"))
  const temp = join(root, "capture.bin")
  let stream: Awaited<ReturnType<GaCaptureStore["open"]>> | undefined
  try {
    const opened = await store.open(reference.storageKey)
    stream = opened
    const iterator = opened[Symbol.asyncIterator]()
    const web = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(Buffer.from(next.value))
      },
      cancel() {
        opened.destroy()
      },
    })
    await streamToProtectedFile(
      web,
      reference.artifactBytes,
      reference.artifactSha256,
      temp,
    )
    const verified = await verifyGaCaptureFile(
      temp,
      reference.artifactSha256,
      reference.artifactBytes,
    )
    const scalars: Partial<typeof verified.header> = { ...verified.header }
    delete scalars.blocks
    delete scalars.baseQualification
    const actual = gaCaptureSnapshotRefSchema.parse({
      ...scalars,
      storageKey: reference.storageKey,
      artifactSha256: verified.artifactSha256,
      artifactBytes: verified.artifactBytes,
      headerSha256: verified.headerSha256,
    })
    if (canonicalGaCaptureJson(actual) !== canonicalGaCaptureJson(reference))
      throw new GaCaptureError(
        "GA capture reference differs from stored artifact",
      )
    return verified
  } finally {
    stream?.destroy()
    await rm(root, { recursive: true, force: true })
  }
}

export async function handleGaCaptureGet(
  prisma: PrismaClient,
  request: Request,
  store: GaCaptureStore,
): Promise<Response> {
  if (
    !isValidMastraRecommendationIngestBearer(
      request.headers.get("authorization"),
    )
  )
    return error("Authorization required", 401)
  const identity = identityHeaders(request)
  if (!identity) return error("Invalid GA capture identity", 400)
  const generation = await verifiedGeneration(prisma, identity)
  const bound = generation?.historicalQualification as {
    snapshotRef?: unknown
  } | null
  const reference = gaCaptureSnapshotRefSchema.safeParse(bound?.snapshotRef)
  if (!generation || !reference.success || generation.status === "retiring")
    return error("Sealed GA capture is unavailable", 404)
  if (
    reference.data.generationId !== generation.id ||
    reference.data.generationInputDigest !== generation.inputDigest ||
    reference.data.sourceSetDigest !== generation.sourceSetDigest ||
    reference.data.inputCutoff !== generation.inputCutoff.toISOString() ||
    reference.data.storageKey !==
      gaCaptureStorageKey(generation.id, reference.data.artifactSha256)
  )
    return error("GA capture identity differs", 409)
  try {
    const stream = await store.open(reference.data.storageKey)
    const iterator = stream[Symbol.asyncIterator]()
    let deliveredBytes = 0
    const web = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) {
            if (deliveredBytes !== reference.data.artifactBytes)
              throw new GaCaptureError("Sealed GA capture ended early")
            controller.close()
            stream.destroy()
            return
          }
          const bytes = Buffer.from(next.value)
          if (
            deliveredBytes + bytes.length > reference.data.artifactBytes ||
            deliveredBytes + bytes.length > GA_CAPTURE_MAX_BYTES
          )
            throw new GaCaptureError("Sealed GA capture exceeds declared size")
          deliveredBytes += bytes.length
          controller.enqueue(bytes)
        } catch (cause) {
          stream.destroy()
          controller.error(cause)
        }
      },
      cancel() {
        stream.destroy()
      },
    })
    return new Response(web, {
      headers: {
        "content-type": GA_CAPTURE_CONTENT_TYPE,
        "content-length": String(reference.data.artifactBytes),
        "x-forge-artifact-sha256": reference.data.artifactSha256,
        "cache-control": "private, no-store",
      },
    })
  } catch {
    return error("Sealed GA capture is unavailable", 404)
  }
}
