import { createRequire } from "node:module"
import { schema } from "@/graphql/schema"
const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")
import { readFile } from "node:fs/promises"
import { importStudioBaseline } from "./baseline"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { StudioAssetService } from "./assets"
import { MediaAssetService } from "../media-asset.service"
import { StudioTransferService } from "./transfers"
import { StudioExperimentService } from "./experiments"
import { ContentPackService } from "./packs"
import { StudioAuthoringService } from "./index"

class AssetHarnessError extends Error {}
const url = env.STUDIO_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const user = {
  id: "studio-455-operator",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
suite("Studio immutable asset service with real Postgres and bytes", () => {
  let db: PrismaClient
  let assets: StudioAssetService
  beforeAll(() => {
    const parsed = new URL(url!)
    if (
      parsed.hostname !== "127.0.0.1" ||
      !(
        (parsed.port === "55455" &&
          parsed.pathname === "/forge_studio_455_test") ||
        (parsed.port === "55457" &&
          parsed.pathname === "/forge_studio_457_test") ||
        (parsed.port === "55459" &&
          parsed.pathname === "/forge_studio_459_test") ||
        (parsed.port === "55456" &&
          parsed.pathname === "/forge_studio_456_test")
      )
    )
      throw new AssetHarnessError("Only isolated Studio test databases allowed")
    db = new PrismaClient({ datasources: { db: { url } } })
    assets = new StudioAssetService(db)
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it("exposes bounded asset and pack selection through authorized GraphQL", async () => {
    const execute = (
      source: string,
      variables: Record<string, unknown>,
      principal: unknown = user,
    ) =>
      graphql({
        schema,
        source,
        variableValues: variables,
        contextValue: { user: principal, prisma: db },
      })
    const bytes = await assets.register(
      user,
      {
        filename: "graphql-source.txt",
        mimeType: "text/plain",
        role: "document",
        provenance: { status: "unknown", recorded: {} },
        idempotencyKey: randomUUID(),
      },
      Buffer.from("Exact source"),
      "LOCAL",
    )
    const query =
      "query($reference: JSON!) { studioAsset(reference: $reference) { reference { assetId versionId digest } role } }"
    expect((await execute(query, { reference: bytes.reference })).data).toEqual(
      { studioAsset: { reference: bytes.reference, role: "document" } },
    )
    for (const principal of [null, { role: "VIEWER", id: "reader" }])
      expect(
        (await execute(query, { reference: bytes.reference }, principal))
          .errors,
      ).toBeDefined()
    expect(
      (
        await execute(
          "query { studioAssets(input: {limit: 101}) { role } }",
          {},
        )
      ).errors,
    ).toBeDefined()
    const input = {
      packId: randomUUID(),
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        title: "Transport pack",
        guidance: "Editorial instructions",
        sources: [
          {
            label: "Evidence",
            asset: bytes.reference,
            excerpt: "Exact source",
          },
        ],
      },
    }
    const created = await execute(
      "mutation($input: JSON!) { writeStudioContentPack(input: $input) { id number document } }",
      { input },
    )
    expect(created.errors).toBeUndefined()
    expect(created.data?.writeStudioContentPack).toMatchObject({
      number: 1,
      document: input.document,
    })
    const read = await execute(
      "mutation($reference: JSON!) { issueStudioAssetRead(reference: $reference) { path method } }",
      { reference: bytes.reference },
    )
    expect(read.errors).toBeUndefined()
    expect(read.data?.issueStudioAssetRead).toMatchObject({ method: "GET" })
  })
  it("keeps deletion working for ordinary unused assets", async () => {
    const generic = new MediaAssetService(db)
    const asset = await generic.create({
      user: { role: "ADMIN", id: null },
      input: { kind: "FILE", mimeType: "text/plain" },
    })
    await generic.delete({ user, id: asset.id })
    expect(await generic.getById({ user, id: asset.id, query: {} })).toBeNull()
  })
  it("derives the provider voice ID from the exact preset version instead of its asset family", async () => {
    const preset = {
      language: "english",
      provider: "provider",
      model: "model",
      voiceId: "provider-voice-42",
      settings: { speed: 1 },
      pronunciation: null,
    }
    const voice = await assets.register(
      user,
      {
        idempotencyKey: randomUUID(),
        filename: "voice.json",
        mimeType: "application/json",
        role: "voice",
        provenance: { status: "recorded", recorded: {} },
        voice: preset,
      },
      Buffer.from(JSON.stringify(preset)),
      "LOCAL",
    )
    const speech = {
      text: "Hello",
      role: "bridge",
      suppressed: false,
      voice: voice.reference,
      provider: "provider",
      model: "model",
      settings: { speed: 1.1 },
      pronunciation: null,
    }
    expect(await assets.narrationIdentity(user, "english", speech)).toEqual({
      ...preset,
      text: "Hello",
      role: "bridge",
      settings: { speed: 1.1 },
    })
    await expect(
      assets.narrationIdentity(user, "english", {
        ...speech,
        pronunciation: voice.reference,
      }),
    ).rejects.toThrow("INVALID")
    await expect(
      assets.register(
        user,
        {
          idempotencyKey: randomUUID(),
          filename: "invalid-dictionary.json",
          mimeType: "application/json",
          role: "voice",
          provenance: { status: "recorded", recorded: {} },
          voice: { ...preset, pronunciation: voice.reference },
        },
        Buffer.from("invalid"),
        "LOCAL",
      ),
    ).rejects.toThrow("INVALID")
    const dictionary = await assets.register(
      user,
      {
        idempotencyKey: randomUUID(),
        filename: "dictionary.json",
        mimeType: "application/json",
        role: "pronunciation",
        provenance: { status: "recorded", recorded: {} },
      },
      Buffer.from("{}"),
      "LOCAL",
    )
    expect(
      await assets.narrationIdentity(user, "english", {
        ...speech,
        pronunciation: dictionary.reference,
      }),
    ).toMatchObject({ pronunciation: dictionary.reference })
    await expect(
      assets.narrationIdentity(user, "english", {
        ...speech,
        provider: "other",
      }),
    ).rejects.toThrow("INVALID")
    await expect(
      assets.register(
        user,
        {
          idempotencyKey: randomUUID(),
          filename: "missing.mp3",
          mimeType: "audio/mpeg",
          role: "narration",
          provenance: { status: "recorded", recorded: {} },
        },
        Buffer.from("recorded"),
        "LOCAL",
      ),
    ).rejects.toThrow("identity")
  })
  it("retains component and generated revision assets and rejects forged version references atomically", async () => {
    const image = await assets.register(
      user,
      {
        idempotencyKey: randomUUID(),
        filename: "background.png",
        mimeType: "image/png",
        role: "background",
        provenance: { status: "unknown", recorded: {} },
      },
      Buffer.from("image bytes"),
      "LOCAL",
    )
    const code = await assets.register(
      user,
      {
        idempotencyKey: randomUUID(),
        filename: "component.tsx",
        mimeType: "text/typescript",
        role: "component",
        provenance: { status: "unknown", recorded: {} },
      },
      Buffer.from("export default () => null"),
      "LOCAL",
    )
    const service = new StudioAuthoringService(db),
      projectId = randomUUID(),
      componentId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Generated layout",
        language: "english",
        runtimeVersion: "runtime",
        width: 1280,
        height: 720,
        fps: 30,
        durationInFrames: 300,
        tracks: [{ id: "main", kind: "visual" }],
        components: [
          {
            versionId: componentId,
            code: code.reference,
            runtimeVersion: "runtime",
            dependencies: [],
            width: 1280,
            height: 720,
            duration: { minFrames: 1, maxFrames: 300 },
            assets: [image.reference],
            controls: {},
          },
        ],
        items: [],
        packRevisionIds: [],
      },
    })
    const attempt = await service.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "GENERATION",
      instructions: [],
    })
    await service.complete(
      { role: "SYSTEM", id: null },
      {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        attemptId: attempt.attemptId,
        status: "SUCCEEDED",
        result: { assets: [image.reference], costMicros: 0 },
        operations: [
          {
            kind: "insert-item",
            item: {
              id: "image",
              kind: "image",
              trackId: "main",
              startFrame: 0,
              durationInFrames: 300,
              asset: image.reference,
            },
          },
        ],
      },
    )
    const usages = await new MediaAssetService(db).usage({
      user,
      id: image.mediaAssetId,
    })
    expect(usages.map((u) => u.resourceType)).toEqual(
      expect.arrayContaining([
        "STUDIO_COMPONENT",
        "STUDIO_ATTEMPT",
        "STUDIO_REVISION",
      ]),
    )
    await expect(
      service.apply(user, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        operations: [
          {
            kind: "insert-item",
            item: {
              id: "bad",
              kind: "image",
              trackId: "main",
              startFrame: 0,
              durationInFrames: 1,
              asset: { ...image.reference, digest: "f".repeat(64) },
            },
          },
        ],
      }),
    ).rejects.toThrow()
    expect((await service.read(user, projectId)).revision).toBe(2)
  })
  it("scopes byte transfer to one version or one exact upload and rejects bad checksums", async () => {
    const transfers = new StudioTransferService(db)
    const metadata = {
      filename: "upload.txt",
      mimeType: "text/plain",
      role: "document",
      provenance: { status: "unknown", recorded: {} },
      idempotencyKey: randomUUID(),
    }
    const grant = await transfers.issue(user, "upload", {
      metadata,
      digest:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      byteSize: 3,
    })
    const token = grant.path.split("/").at(-1)!
    await expect(
      transfers.upload(token, new Response("bad").body),
    ).rejects.toThrow("INVALID")
    const asset = await transfers.upload(token, new Response("abc").body)
    await expect(transfers.download(token)).rejects.toThrow("Forbidden")
    const read = await transfers.issue(user, "read", asset.reference)
    expect(
      Buffer.from(
        (await transfers.download(read.path.split("/").at(-1)!)).bytes,
      ).toString(),
    ).toBe("abc")
    await expect(
      transfers.issue(null, "read", asset.reference),
    ).rejects.toThrow("Forbidden")
    await expect(transfers.download("0".repeat(64))).rejects.toThrow(
      "Forbidden",
    )
  })
  it("admits only explicit cost-bounded experiments and retains candidate provenance", async () => {
    const experiments = new StudioExperimentService(db)
    const request = {
      idempotencyKey: randomUUID(),
      kind: "music",
      provider: "fixture",
      model: "model",
      language: "english",
      prompt: "Quiet strings",
      settings: { durationSeconds: 30, instrumental: true },
      candidateCount: 2,
      estimate: {
        currency: "USD",
        amountMicros: 1000,
        basis: "fixture quote",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
      maxCostMicros: 2000,
      confirmed: true,
    }
    await expect(
      experiments.request(user, { ...request, confirmed: false }),
    ).rejects.toThrow()
    await expect(
      experiments.request({ role: "SYSTEM", id: null }, request),
    ).rejects.toThrow("human")
    await expect(
      experiments.request(user, { ...request, settings: undefined }),
    ).rejects.toThrow()
    const admitted = await experiments.request(user, request)
    expect((await experiments.request(user, request)).id).toBe(admitted.id)
    expect((await experiments.read(user, admitted.id)).candidates).toEqual([])
    const candidate = await assets.register(
      user,
      {
        filename: "candidate.mp3",
        mimeType: "audio/mpeg",
        role: "music",
        idempotencyKey: randomUUID(),
        provenance: {
          status: "recorded",
          recorded: {
            experimentId: admitted.id,
            provider: request.provider,
            model: request.model,
            prompt: request.prompt,
            language: request.language,
            settings: request.settings,
          },
        },
      },
      Buffer.from("candidate bytes"),
      "LOCAL",
    )
    await experiments.addCandidate(
      { role: "SYSTEM", id: null },
      {
        experimentId: admitted.id,
        candidateKey: randomUUID(),
        asset: candidate.reference,
        providerRequestId: null,
        actualCostMicros: 1200,
      },
    )
    for (const settings of [undefined, { durationSeconds: 90 }]) {
      const mismatched = await assets.register(
        user,
        {
          filename: "invalid-music.mp3",
          mimeType: "audio/mpeg",
          role: "music",
          idempotencyKey: randomUUID(),
          provenance: {
            status: "recorded",
            recorded: {
              experimentId: admitted.id,
              provider: request.provider,
              model: request.model,
              prompt: request.prompt,
              language: request.language,
              ...(settings ? { settings } : {}),
            },
          },
        },
        Buffer.from("mismatched"),
        "LOCAL",
      )
      await expect(
        experiments.addCandidate(
          { role: "SYSTEM", id: null },
          {
            experimentId: admitted.id,
            candidateKey: randomUUID(),
            asset: mismatched.reference,
            providerRequestId: null,
            actualCostMicros: 0,
          },
        ),
      ).rejects.toThrow("INVALID")
    }
    expect((await experiments.read(user, admitted.id)).candidates).toHaveLength(
      1,
    )
    expect(
      (
        await new MediaAssetService(db).usage({
          user,
          id: candidate.mediaAssetId,
        })
      ).some((u) => u.resourceType === "STUDIO_EXPERIMENT_CANDIDATE"),
    ).toBe(true)
    for (let i = 0; i < 2; i++)
      await experiments.addCandidate(
        { role: "SYSTEM", id: null },
        {
          experimentId: admitted.id,
          candidateKey: randomUUID(),
          asset: candidate.reference,
          providerRequestId: "provider-output-" + i,
          actualCostMicros: 1200,
        },
      )
    const retained = await experiments.read(user, admitted.id)
    expect(retained.candidates).toHaveLength(3)
    expect(retained.outcome).toEqual({
      status: "OVERRUN",
      actualCostMicros: "3600",
      candidateCount: 3,
      costExceeded: true,
      countExceeded: true,
    })
  })
  it("imports all 132 preserved originals without inventing narration identity or Studio approval", async () => {
    const inventory = JSON.parse(
      await readFile(
        "../../docs/plans/fixtures/studio-lyuba-baseline/inventory.json",
        "utf8",
      ),
    )
    const imported = await importStudioBaseline(
      assets,
      user,
      "/home/tataihono/.local/share/forge/studio-lyuba-baseline/originals",
      inventory,
      "LOCAL",
    )
    expect(imported).toHaveLength(132)
    expect(imported.filter((a) => a.role === "narration")).toHaveLength(87)
    for (let i = 0; i < imported.length; i++) {
      const item = imported[i]!
      expect(item.reference.digest).toBe(inventory.files[i].sha256)
      expect((await assets.readBytes(user, item.reference)).length).toBe(
        inventory.files[i].bytes,
      )
      expect(item.narration).toBeNull()
      expect(item.provenance.status).toBe("unknown")
    }
  }, 60000)
  it("versions pack evidence separately from guidance and retains historical project edges", async () => {
    const asset = await assets.register(
      user,
      {
        filename: "evidence.txt",
        mimeType: "text/plain",
        role: "document",
        provenance: { status: "unknown", recorded: {} },
        idempotencyKey: randomUUID(),
      },
      Buffer.from("source quotation"),
      "LOCAL",
    )
    const packs = new ContentPackService(db)
    const packId = randomUUID()
    const first = await packs.write(user, {
      packId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        title: "Source pack",
        guidance: "Prefer reflective pacing",
        sources: [
          {
            label: "Evidence",
            asset: asset.reference,
            excerpt: "source quotation",
          },
        ],
      },
    })
    const second = await packs.write(user, {
      packId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      document: {
        title: "Source pack",
        guidance: "New direction",
        sources: [],
      },
    })
    expect((await packs.read(user, first.id)).document.guidance).toBe(
      "Prefer reflective pacing",
    )
    expect((await packs.read(user, second.id)).document.sources).toEqual([])
    const projects = new StudioAuthoringService(db)
    const projectId = randomUUID()
    await projects.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Any arrangement",
        language: "english",
        runtimeVersion: "runtime-1",
        width: 1280,
        height: 720,
        fps: 30,
        durationInFrames: 300,
        tracks: [],
        items: [],
        components: [],
        packRevisionIds: [first.id],
      },
    })
    await projects.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { kind: "assign-content-packs", packRevisionIds: [second.id] },
      ],
    })
    const usage = await new MediaAssetService(db).usage({
      user,
      id: asset.mediaAssetId,
    })
    expect(
      usage.some(
        (u) =>
          u.resourceType === "STUDIO_REVISION" &&
          u.resourceId.includes(projectId),
      ),
    ).toBe(true)
    expect(
      usage.some(
        (u) =>
          u.resourceType === "CONTENT_PACK_REVISION" &&
          u.resourceId === first.id,
      ),
    ).toBe(true)
    await expect(
      packs.write(user, {
        packId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        document: { title: "stale", guidance: "", sources: [] },
      }),
    ).rejects.toThrow("CONFLICT")
  })
  it("protects retained versions from generic deletion, byte replacement and visibility changes", async () => {
    const asset = await assets.register(
      user,
      {
        filename: "retained.txt",
        mimeType: "text/plain",
        role: "document",
        provenance: { status: "unknown", recorded: {} },
        idempotencyKey: randomUUID(),
      },
      Buffer.from("retained"),
      "LOCAL",
    )
    const generic = new MediaAssetService(db)
    await expect(
      generic.delete({ user, id: asset.mediaAssetId }),
    ).rejects.toThrow()
    await expect(
      generic.update({
        user,
        input: { id: asset.mediaAssetId, checksumSha256: "a".repeat(64) },
      }),
    ).rejects.toThrow()
    await expect(
      generic.update({
        user,
        input: { id: asset.mediaAssetId, visibility: "PUBLIC" },
      }),
    ).rejects.toThrow()
    await expect(
      db.studioAssetVersion.delete({
        where: { id: asset.reference.versionId },
      }),
    ).rejects.toThrow()
    expect(
      Buffer.from(await assets.readBytes(user, asset.reference)).toString(),
    ).toBe("retained")
  })
  it("only matches exact known narration including explicit dictionary absence", async () => {
    const identity = {
      text: `Hello ${randomUUID()}`,
      role: "bridge",
      language: "english",
      provider: "elevenlabs",
      model: "model",
      voiceId: "voice",
      settings: { speed: 1 },
      pronunciation: null,
    }
    const input = {
      filename: "speech.mp3",
      mimeType: "audio/mpeg",
      role: "narration",
      provenance: { status: "recorded", recorded: {} },
      narration: identity,
      idempotencyKey: randomUUID(),
    }
    const asset = await assets.register(
      user,
      input,
      Buffer.from("audio fixture"),
      "LOCAL",
    )
    expect(
      (await assets.findNarration(user, identity)).map(
        (v) => v.reference.versionId,
      ),
    ).toContain(asset.reference.versionId)
    for (const changed of [
      { text: "hello" },
      { role: "closing" },
      { language: "en" },
      { provider: "other" },
      { model: "other" },
      { voiceId: "other" },
      { settings: { speed: 1.1 } },
      {
        pronunciation: {
          assetId: "dict",
          versionId: "v1",
          digest: "a".repeat(64),
        },
      },
    ])
      expect(
        await assets.findNarration(user, { ...identity, ...changed }),
      ).toEqual([])
    await assets.register(
      user,
      {
        ...input,
        idempotencyKey: randomUUID(),
        narration: undefined,
        provenance: {
          status: "unknown",
          recorded: { text: "Hello", voiceId: "voice" },
        },
      },
      Buffer.from("historic"),
      "LOCAL",
    )
    expect(await assets.findNarration(user, identity)).toHaveLength(1)
  })
  it("retains original bytes through a replacement and a new service connection", async () => {
    const input = {
      filename: "original.txt",
      mimeType: "text/plain",
      role: "document",
      provenance: { status: "unknown", recorded: {} },
      idempotencyKey: randomUUID(),
    }
    const original = await assets.register(
      user,
      input,
      Buffer.from("abc"),
      "LOCAL",
    )
    expect(original.reference.digest).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
    const next = await assets.register(
      user,
      { ...input, idempotencyKey: randomUUID(), replaces: original.reference },
      Buffer.from("changed"),
      "LOCAL",
    )
    expect(next.reference.assetId).toBe(original.reference.assetId)
    expect(next.reference.versionId).not.toBe(original.reference.versionId)
    const restarted = new PrismaClient({ datasources: { db: { url } } })
    try {
      expect(
        Buffer.from(
          await new StudioAssetService(restarted).readBytes(
            user,
            original.reference,
          ),
        ).toString(),
      ).toBe("abc")
      expect(
        Buffer.from(await assets.readBytes(user, next.reference)).toString(),
      ).toBe("changed")
      await expect(assets.readBytes(null, original.reference)).rejects.toThrow(
        "Forbidden",
      )
    } finally {
      await restarted.$disconnect()
    }
  })
})
