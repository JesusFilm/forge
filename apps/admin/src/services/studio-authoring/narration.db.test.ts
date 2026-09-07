import { readFileSync } from "node:fs"
import {
  studioDocumentSchema,
  studioOperationSchema,
} from "@forge/studio-contracts"
import { studioHash } from "./state"
import { ForbiddenError } from "../errors"
import { StudioSourceService } from "./sources"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { StudioAssetService } from "./assets"
import { StudioAuthoringService } from "./index"
import { StudioNarrationService } from "./narration"
import { StudioGenerationService } from "./generation"
import { StudioExecutionService } from "./execution"
import { env } from "@/config/env"

const url = env.STUDIO_TEST_DATABASE_URL
const human = {
  id: "narration-operator",
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
const worker = { id: null, role: "MANAGER_BACKEND" as const }
class FixtureError extends Error {}
;(url ? describe : describe.skip)("Canonical narration completion", () => {
  let db: PrismaClient
  beforeAll(() => {
    if (url !== "postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test")
      throw new FixtureError("Use task-owned database only")
    db = new PrismaClient({ datasources: { db: { url } } })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  async function fixture() {
    const assets = new StudioAssetService(db),
      commands = new StudioAuthoringService(db)
    const preset = {
      language: "en",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: `voice-${randomUUID()}`,
      settings: {},
      pronunciation: null,
    }
    const voice = await assets.register(
      human,
      {
        idempotencyKey: randomUUID(),
        filename: "voice.json",
        mimeType: "application/json",
        role: "voice",
        provenance: { status: "recorded", recorded: {} },
        voice: preset,
      },
      Buffer.from("preset"),
      "LOCAL",
    )
    const speech = {
      text: "Take a quiet breath.",
      role: "settle",
      suppressed: false,
      voice: voice.reference,
      provider: preset.provider,
      model: preset.model,
      settings: {},
      pronunciation: null,
    }
    const projectId = randomUUID()
    await commands.create(human, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        version: 1,
        title: "Standalone",
        language: "en",
        runtimeVersion: "studio-proof-1",
        width: 1080,
        height: 1920,
        fps: 30,
        durationInFrames: 90,
        tracks: [{ id: "main", kind: "visual" }],
        components: [],
        packRevisionIds: [],
        items: [
          {
            id: "settle",
            kind: "text",
            trackId: "main",
            startFrame: 0,
            durationInFrames: 30,
            text: "Pause",
            properties: {},
            speech,
          },
          {
            id: "next",
            kind: "text",
            trackId: "main",
            startFrame: 30,
            durationInFrames: 60,
            text: "Next",
            properties: {},
          },
        ],
      },
    })
    await commands.approve(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    })
    const attempt = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const identity = await assets.narrationIdentity(human, "en", speech)
    const audio = await assets.register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "settle.mp3",
        mimeType: "audio/mpeg",
        role: "narration",
        narration: identity,
        provenance: { status: "recorded", recorded: { durationMs: 2000 } },
      },
      Buffer.from("fixture audio bytes"),
      "LOCAL",
    )
    const chunk = await assets.register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "chunk.json",
        mimeType: "application/json",
        role: "manifest",
        dependencies: [audio.reference],
        provenance: { status: "recorded", recorded: {} },
      },
      Buffer.from(
        JSON.stringify({
          version: 1,
          entries: [
            { itemId: "settle", asset: audio.reference, durationMs: 2000 },
          ],
        }),
      ),
      "LOCAL",
    )
    const manifest = await assets.register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "narration.json",
        mimeType: "application/json",
        role: "manifest",
        dependencies: [chunk.reference],
        provenance: { status: "recorded", recorded: {} },
      },
      Buffer.from(JSON.stringify({ version: 1, chunks: [chunk.reference] })),
      "LOCAL",
    )
    return { assets, commands, projectId, attempt, manifest, audio, speech }
  }
  it("returns actual admitted role facts for the rejected native ch31 proposal without applying it", async () => {
    const { commands, projectId, speech } = await fixture()
    const evidence = new URL(
      "../../../../../docs/validation/studio-458/",
      import.meta.url,
    )
    const input = JSON.parse(
      readFileSync(
        new URL(
          "native-hosted-proposal/corrected-readonly-proposal.body",
          evidence,
        ),
        "utf8",
      ),
    )
    const rejected = JSON.parse(
      readFileSync(
        new URL(
          "native-hosted-live/paid-1-2-response-proposal-0.json",
          evidence,
        ),
        "utf8",
      ),
    )
    const admitted = studioDocumentSchema.parse(input.cases[1].project.document)
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "restore-document",
          document: {
            ...admitted,
            packRevisionIds: [],
            items: admitted.items.map((item) => ({
              ...item,
              speech: {
                ...speech,
                text: item.speech!.text,
                role: item.speech!.role,
              },
            })),
          },
        },
      ],
    })
    const before = await commands.read(human, projectId)
    await expect(
      new StudioGenerationService(db).validate(human, {
        command: {
          projectId,
          expectedRevision: 2,
          idempotencyKey: randomUUID(),
          operations: rejected.operations,
        },
        quality: rejected.quality,
      }),
    ).rejects.toMatchObject({
      feedback: {
        code: "ROLE_COVERAGE_MISMATCH",
        role: "hook",
        expectedItemCount: 0,
        expectedItemIds: [],
        observedRoles: ["bridge", "reflection", "settle"],
      },
    })
    expect(await commands.read(human, projectId)).toEqual(before)
  })
  it("returns safe field facts for actual ch19 properties, then preserves its coverage rejection", async () => {
    const { commands, projectId, speech } = await fixture()
    const evidence = new URL(
      "../../../../../docs/validation/studio-458/",
      import.meta.url,
    )
    const input = JSON.parse(
      readFileSync(
        new URL(
          "native-hosted-proposal/corrected-readonly-proposal.body",
          evidence,
        ),
        "utf8",
      ),
    )
    const rejected = JSON.parse(
      readFileSync(
        new URL(
          "native-hosted-followup-2/live/paid-0-2-response-proposal-0.json",
          evidence,
        ),
        "utf8",
      ),
    )
    const admitted = studioDocumentSchema.parse(input.cases[0].project.document)
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "restore-document",
          document: {
            ...admitted,
            packRevisionIds: [],
            items: admitted.items.map((item) => ({
              ...item,
              speech: {
                ...speech,
                text: item.speech!.text,
                role: item.speech!.role,
              },
            })),
          },
        },
      ],
    })
    const before = await commands.read(human, projectId)
    await expect(
      new StudioGenerationService(db).validate(human, {
        command: {
          projectId,
          expectedRevision: 2,
          idempotencyKey: randomUUID(),
          operations: rejected.operations,
        },
        quality: rejected.quality,
      }),
    ).rejects.toMatchObject({
      feedback: {
        code: "PROPOSAL_FIELD_TYPE_MISMATCH",
        issues: [
          {
            path: ["operations", 6, "properties", "fontSize"],
            expected: "number",
          },
        ],
      },
    })
    expect(await commands.read(human, projectId)).toEqual(before)
    const correctedTypes = rejected.operations.map((raw: unknown) => {
      const operation = studioOperationSchema.parse(raw)
      return operation.kind === "set-properties"
        ? {
            ...operation,
            properties: {
              ...operation.properties,
              fontSize: operation.itemId === "settle" ? 56 : 52,
            },
          }
        : operation
    })
    await expect(
      new StudioGenerationService(db).validate(human, {
        command: {
          projectId,
          expectedRevision: 2,
          idempotencyKey: randomUUID(),
          operations: correctedTypes,
        },
        quality: rejected.quality,
      }),
    ).rejects.toMatchObject({
      feedback: { code: "ROLE_COVERAGE_UNCHECKED_IDS", role: "video" },
    })
    expect(await commands.read(human, projectId)).toEqual(before)
  })
  it("reviews speech in canonical timeline order even when insertion order is opposite", async () => {
    const { commands, projectId, speech } = await fixture()
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "move-item",
          itemId: "settle",
          trackId: "main",
          startFrame: 60,
        },
        {
          kind: "set-speech",
          itemId: "next",
          speech: { ...speech, role: "bridge", text: "The earlier bridge." },
        },
      ],
    })
    const plan = await new StudioNarrationService(db).plan(human, {
      projectId,
      expectedRevision: 2,
    })
    expect(plan.segments.map((segment) => segment.itemId)).toEqual([
      "next",
      "settle",
    ])
    expect(plan.segments.map((segment) => segment.identity.text)).toEqual([
      "The earlier bridge.",
      "Take a quiet breath.",
    ])
  })
  it("preflights explicit language mapping and pinned pronunciation locators before dispatch", async () => {
    const { commands, projectId, speech, assets } = await fixture()
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "set-speech",
          itemId: "settle",
          speech: { ...speech, settings: { language_code: "fr" } },
        },
      ],
    })
    await expect(
      new StudioNarrationService(db).plan(human, {
        projectId,
        expectedRevision: 2,
      }),
    ).rejects.toThrow("language")
    const dictionary = await assets.register(
      human,
      {
        idempotencyKey: randomUUID(),
        filename: "dictionary.json",
        mimeType: "application/json",
        role: "pronunciation",
        provenance: {
          status: "recorded",
          recorded: {
            locators: [
              { pronunciation_dictionary_id: "dictionary-without-version" },
            ],
          },
        },
      },
      Buffer.from("dictionary fixture"),
      "LOCAL",
    )
    await commands.apply(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "set-speech",
          itemId: "settle",
          speech: { ...speech, pronunciation: dictionary.reference },
        },
      ],
    })
    await expect(
      new StudioNarrationService(db).plan(human, {
        projectId,
        expectedRevision: 3,
      }),
    ).rejects.toThrow()
  })

  it("retains hosted generation output and frozen provenance without applying it over newer edits", async () => {
    const { commands, projectId } = await fixture()
    const attempt = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "GENERATION",
      instructions: [],
    })
    const service = new StudioGenerationService(db)
    const output = {
      text: "A source-led draft",
      diagnostics: [],
      proposals: [
        {
          summary: "A revised display title",
          command: {
            projectId,
            expectedRevision: 1,
            idempotencyKey: randomUUID(),
            operations: [{ kind: "set-metadata", title: "Proposed" }],
          },
        },
      ],
    }
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "set-metadata", title: "Newer human edit" }],
    })
    const completion = {
      projectId,
      expectedRevision: 1,
      attemptId: attempt.attemptId,
      idempotencyKey: randomUUID(),
      status: "SUCCEEDED",
      operations: [],
      result: { assets: [], costMicros: null },
    }
    expect(await service.complete(worker, completion, output)).toMatchObject({
      outcome: "STALE",
      revision: 2,
    })
    expect(await service.complete(worker, completion, output)).toMatchObject({
      outcome: "STALE",
      revision: 2,
    })
    const retained = await service.read(human, { attemptId: attempt.attemptId })
    expect(retained.previews[0].document.title).toBe("Proposed")
    expect((await commands.read(human, projectId)).document.title).toBe(
      "Newer human edit",
    )
    expect(retained.text).toBe(output.text)
    await expect(
      service.complete(human, completion, output),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it.each([false, true])(
    "ripples only linked followers, preserving unrelated music; linked timing lock=%s",
    async (locked) => {
      const { commands, assets, projectId, manifest } = await fixture()
      const music = await assets.register(
        human,
        {
          idempotencyKey: randomUUID(),
          filename: "music.mp3",
          mimeType: "audio/mpeg",
          role: "music",
          provenance: { status: "recorded", recorded: {} },
        },
        Buffer.from("music timing fixture"),
        "LOCAL",
      )
      await commands.apply(human, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        operations: [
          { kind: "add-track", track: { id: "linked", kind: "visual" } },
          { kind: "add-track", track: { id: "music", kind: "audio" } },
          {
            kind: "insert-item",
            item: {
              id: "linked-tail",
              kind: "text",
              trackId: "linked",
              linkedTo: "next",
              startFrame: 30,
              durationInFrames: 60,
              text: "Linked next",
              properties: {},
              timingLocked: locked,
            },
          },
          {
            kind: "insert-item",
            item: {
              id: "music",
              kind: "audio",
              trackId: "music",
              startFrame: 0,
              durationInFrames: 90,
              sourceStartMs: 0,
              asset: music.reference,
              volume: 0.25,
              timingLocked: true,
            },
          },
        ],
      })
      await commands.approve(human, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        kind: "SCRIPT",
      })
      const attempt = await commands.request(human, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        kind: "NARRATION",
        instructions: [],
      })
      const result = await new StudioNarrationService(db).complete(worker, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        attemptId: attempt.attemptId,
        manifest: manifest.reference,
        costMicros: null,
      })
      const document = (await commands.read(human, projectId)).document
      if (locked) expect(result.timingConflicts).toContain("linked-tail")
      else
        expect(
          document.items.find((i) => i.id === "linked-tail"),
        ).toMatchObject({ startFrame: 60, durationInFrames: 60 })
      expect(document.items.find((i) => i.id === "music")).toMatchObject({
        startFrame: 0,
        durationInFrames: 90,
        volume: 0.25,
      })
    },
  )

  it("preserves exact unrelated video cuts and returns a conflict instead of stretching a linked cut", async () => {
    const { commands, projectId, manifest } = await fixture(),
      prefix = randomUUID()
    const language = await db.language.upsert({
      where: { slug: "en" },
      create: {
        id: prefix + "lang",
        coreId: prefix + "lang",
        slug: "en",
        bcp47: "en",
      },
      update: {},
    })
    await db.video.create({
      data: {
        id: prefix,
        coreId: prefix,
        slug: prefix,
        locales: {
          create: { locale: "en", title: "Timing source", status: "PUBLISHED" },
        },
      },
    })
    await db.videoEdition.create({
      data: {
        id: prefix + "edition",
        coreId: prefix + "edition",
        name: "Exact fixture cut",
      },
    })
    await db.videoDub.create({
      data: {
        id: prefix + "dub",
        coreId: prefix + "dub",
        videoId: prefix,
        videoEditionId: prefix + "edition",
        languageId: language.id,
        published: true,
        downloadable: true,
        hls: "http://127.0.0.1/source.m3u8",
        lengthInMilliseconds: 3000,
        downloads: {
          create: {
            id: prefix + "download",
            url: "http://127.0.0.1/source.mp4",
            height: 1080,
          },
        },
      },
    })
    await db.videoSubtitle.create({
      data: {
        id: prefix + "subtitle",
        videoId: prefix,
        videoEditionId: prefix + "edition",
        languageId: language.id,
        primary: true,
        vttSrc: "http://127.0.0.1/track.vtt",
      },
    })
    const source = await new StudioSourceService(
      db,
      async (url) =>
        new TextEncoder().encode(
          url.endsWith(".vtt")
            ? "WEBVTT\n\n00:00.000 --> 00:03.000\nExact source text\n"
            : "source timing fixture",
        ),
      "LOCAL",
    ).capture(human, {
      videoId: prefix,
      dubId: prefix + "dub",
      editionId: prefix + "edition",
      trackId: prefix + "subtitle",
      downloadId: prefix + "download",
      language: "en",
      retainOriginalBytes: true,
      startMs: 0,
      endMs: 3000,
      idempotencyKey: randomUUID(),
    })
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { kind: "add-track", track: { id: "video", kind: "visual" } },
        {
          kind: "insert-item",
          item: {
            id: "video-cut",
            kind: "video",
            trackId: "video",
            startFrame: 0,
            durationInFrames: 90,
            source: source.source,
            volume: 1,
            timingLocked: true,
          },
        },
      ],
    })
    await commands.approve(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    })
    const attempt = await commands.request(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: null,
    })
    const project = await commands.read(human, projectId)
    expect(
      project.document.items.find((i) => i.id === "video-cut"),
    ).toMatchObject({
      startFrame: 0,
      durationInFrames: 90,
      source: source.source,
    })
    const linked = {
      ...project.document,
      items: project.document.items.map((i) =>
        i.id === "video-cut" ? { ...i, linkedTo: "settle" } : i,
      ),
    }
    await commands.apply(human, {
      projectId,
      expectedRevision: 3,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "restore-document", document: linked }],
    })
    const next = await commands.request(human, {
      projectId,
      expectedRevision: 4,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const conflict = await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 4,
      idempotencyKey: randomUUID(),
      attemptId: next.attemptId,
      manifest: manifest.reference,
      costMicros: 0,
    })
    expect(conflict).toMatchObject({
      revision: 4,
      timingConflicts: ["video-cut"],
    })
  })

  it("does not overwrite an unrelated item that reuses a generated audio identity", async () => {
    const { commands, projectId, attempt, manifest } = await fixture()
    const service = new StudioNarrationService(db)
    await service.complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: 0,
    })
    const project = await commands.read(human, projectId),
      audio = project.document.items.find((item) => item.kind === "audio")!
    const replacement = {
      id: audio.id,
      kind: "text",
      trackId: "independent",
      startFrame: 0,
      durationInFrames: 60,
      text: "Keep this manually authored item",
      properties: {},
    }
    await commands.apply(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "restore-document",
          document: {
            ...project.document,
            tracks: [
              ...project.document.tracks,
              { id: "independent", kind: "visual" },
            ],
            items: project.document.items.map((item) =>
              item.id === audio.id ? replacement : item,
            ),
          },
        },
      ],
    })
    const next = await commands.request(human, {
      projectId,
      expectedRevision: 3,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const result = await service.complete(worker, {
      projectId,
      expectedRevision: 3,
      idempotencyKey: randomUUID(),
      attemptId: next.attemptId,
      manifest: manifest.reference,
      costMicros: 0,
    })
    expect(result).toMatchObject({ revision: 3, timingConflicts: [audio.id] })
    expect(
      (await commands.read(human, projectId)).document.items.find(
        (item) => item.id === audio.id,
      ),
    ).toMatchObject(replacement)
  })

  it("attaches verified narration and ripples following content in one revision", async () => {
    const { commands, projectId, attempt, manifest, audio } = await fixture()
    const result = await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: 100,
    })
    expect(result).toMatchObject({ revision: 2, outcome: "ACCEPTED" })
    const saved = await commands.read(human, projectId)
    expect(
      saved.document.items.find((i) => i.id === "settle")?.durationInFrames,
    ).toBe(60)
    expect(saved.document.items.find((i) => i.id === "next")?.startFrame).toBe(
      60,
    )
    expect(saved.document.items.find((i) => i.kind === "audio")).toMatchObject({
      asset: audio.reference,
      startFrame: 0,
      durationInFrames: 60,
    })
    expect(saved.document.durationInFrames).toBe(120)
  })
  it("retains paid assets and visible timing conflicts without changing locked content", async () => {
    const { commands, projectId, manifest } = await fixture()
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "set-timing",
          itemId: "next",
          durationInFrames: 60,
          timingLocked: true,
        },
      ],
    })
    const attempt = await commands.request(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const result = await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: 100,
    })
    expect(result).toMatchObject({ revision: 2, timingConflicts: ["next"] })
    expect(
      (await commands.read(human, projectId)).document.items.some(
        (i) => i.kind === "audio",
      ),
    ).toBe(false)
    expect(
      (await commands.readAttempt(human, projectId, attempt.attemptId!)).result,
    ).toMatchObject({ manifest: manifest.reference, costMicros: 100 })
  })
  it("rejects changed speech identity and keeps a stale paid completion from replacing edits", async () => {
    const { commands, projectId, attempt, manifest } = await fixture()
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { kind: "set-text", itemId: "settle", text: "A changed bridge." },
      ],
    })
    const stale = await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: 100,
    })
    expect(stale.outcome).toBe("STALE")
    await expect(
      commands.request(human, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        kind: "NARRATION",
        instructions: [],
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
    await commands.approve(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    })
    const fresh = await commands.request(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    await expect(
      new StudioNarrationService(db).complete(worker, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        attemptId: fresh.attemptId,
        manifest: manifest.reference,
        costMicros: 100,
      }),
    ).rejects.toMatchObject({ code: "INVALID" })
    expect((await commands.read(human, projectId)).revision).toBe(2)
  })

  it("keeps narration for visual changes but detaches changed spoken content without deleting assets", async () => {
    const { commands, projectId, attempt, manifest, audio } = await fixture()
    await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: 100,
    })
    await commands.apply(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "set-properties",
          itemId: "settle",
          properties: { color: "#abcdef" },
        },
      ],
    })
    expect(
      (await commands.read(human, projectId)).document.items.filter(
        (i) => i.kind === "audio",
      ),
    ).toHaveLength(1)
    const plan = await new StudioNarrationService(db).plan(human, {
      projectId,
      expectedRevision: 3,
    })
    expect(plan.segments[0].matches).toContainEqual(audio.reference)
    await commands.apply(human, {
      projectId,
      expectedRevision: 3,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "set-text",
          itemId: "settle",
          text: "Take one more quiet breath.",
        },
      ],
    })
    expect(
      (await commands.read(human, projectId)).document.items.filter(
        (i) => i.kind === "audio",
      ),
    ).toHaveLength(0)
    expect(
      await db.studioAssetVersion.findUnique({
        where: { id: audio.reference.versionId },
      }),
    ).not.toBeNull()
    expect(
      (
        await new StudioNarrationService(db).plan(human, {
          projectId,
          expectedRevision: 4,
        })
      ).segments[0].matches,
    ).toEqual([])
  })

  it("does not overwrite a manual narration timing lock when cached duration is unchanged", async () => {
    const { commands, projectId, attempt, manifest } = await fixture()
    await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: 100,
    })
    const audio = (await commands.read(human, projectId)).document.items.find(
      (i) => i.kind === "audio",
    )!
    await commands.apply(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "move-item",
          itemId: audio.id,
          trackId: audio.trackId,
          startFrame: 1,
        },
        {
          kind: "set-timing",
          itemId: audio.id,
          durationInFrames: 60,
          timingLocked: true,
        },
      ],
    })
    const next = await commands.request(human, {
      projectId,
      expectedRevision: 3,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const result = await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 3,
      idempotencyKey: randomUUID(),
      attemptId: next.attemptId,
      manifest: manifest.reference,
      costMicros: 0,
    })
    expect(result).toMatchObject({ revision: 3, timingConflicts: [audio.id] })
    expect(
      (await commands.read(human, projectId)).document.items.find(
        (i) => i.id === audio.id,
      ),
    ).toMatchObject({ startFrame: 1, timingLocked: true })
  })

  it("reconciles simultaneous tracks without global double ripple and preserves unrelated spans and trailing gaps", async () => {
    const { commands, assets, projectId, audio, speech } = await fixture()
    await commands.apply(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { kind: "add-track", track: { id: "parallel", kind: "visual" } },
        { kind: "add-track", track: { id: "background", kind: "visual" } },
        {
          kind: "insert-item",
          item: {
            id: "parallel-speech",
            kind: "text",
            trackId: "parallel",
            startFrame: 0,
            durationInFrames: 30,
            text: "Pause",
            properties: {},
            speech,
          },
        },
        {
          kind: "insert-item",
          item: {
            id: "background-span",
            kind: "text",
            trackId: "background",
            startFrame: 0,
            durationInFrames: 90,
            text: "Background",
            properties: {},
            timingLocked: true,
          },
        },
        {
          kind: "insert-item",
          item: {
            id: "background-tail",
            kind: "text",
            trackId: "background",
            startFrame: 60,
            durationInFrames: 30,
            text: "Unrelated",
            properties: {},
            timingLocked: true,
          },
        },
        { kind: "set-metadata", durationInFrames: 100 },
      ],
    })
    await commands.approve(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    })
    const attempt = await commands.request(human, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const chunk = await assets.register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "parallel-chunk.json",
        mimeType: "application/json",
        role: "manifest",
        dependencies: [audio.reference],
        provenance: { status: "recorded", recorded: {} },
      },
      Buffer.from(
        JSON.stringify({
          version: 1,
          entries: [
            { itemId: "settle", asset: audio.reference, durationMs: 2000 },
            {
              itemId: "parallel-speech",
              asset: audio.reference,
              durationMs: 2000,
            },
          ],
        }),
      ),
      "LOCAL",
    )
    const both = await assets.register(
      worker,
      {
        idempotencyKey: randomUUID(),
        filename: "parallel-root.json",
        mimeType: "application/json",
        role: "manifest",
        dependencies: [chunk.reference],
        provenance: { status: "recorded", recorded: {} },
      },
      Buffer.from(JSON.stringify({ version: 1, chunks: [chunk.reference] })),
      "LOCAL",
    )
    const result = await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: both.reference,
      costMicros: 0,
    })
    expect(result).toMatchObject({ revision: 3 })
    const doc = (await commands.read(human, projectId)).document
    expect(doc.items.find((i) => i.id === "next")?.startFrame).toBe(60)
    expect(doc.items.find((i) => i.id === "parallel-speech")).toMatchObject({
      startFrame: 0,
      durationInFrames: 60,
    })
    expect(doc.items.find((i) => i.id === "background-span")).toMatchObject({
      startFrame: 0,
      durationInFrames: 90,
    })
    expect(doc.items.find((i) => i.id === "background-tail")).toMatchObject({
      startFrame: 60,
      durationInFrames: 30,
    })
    expect(doc.durationInFrames).toBe(130)
    expect(doc.items.filter((i) => i.kind === "audio")).toHaveLength(2)
  })

  it("validates proposed role claims against projected canonical operations without applying them", async () => {
    const { projectId, commands } = await fixture()
    const service = new StudioGenerationService(db)
    const command = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { kind: "set-text", itemId: "settle", text: "A revised quiet moment." },
      ],
    }
    await expect(
      service.validate(human, {
        command,
        quality: {
          coverage: [{ role: "bridge", status: "present", itemIds: [] }],
          findings: [],
        },
      }),
    ).rejects.toThrow("Role coverage")
    const result = await service.validate(human, {
      command,
      quality: {
        coverage: [{ role: "settle", status: "present", itemIds: ["settle"] }],
        findings: [],
      },
    })
    expect(result.valid).toBe(true)
    expect(result).toMatchObject({
      effectiveSpeech: {
        view: "inline",
        complete: true,
        projectId,
        baseRevision: 1,
        items: expect.arrayContaining([
          expect.objectContaining({
            itemId: "settle",
            text: "A revised quiet moment.",
          }),
        ]),
      },
    })
    await expect(
      service.validate(human, {
        command,
        quality: {
          coverage: [],
          findings: [
            {
              criterion: "source-fidelity",
              status: "pass",
              reason: "Claimed source citation",
              itemIds: ["settle"],
              sources: [
                {
                  assetId: randomUUID(),
                  versionId: randomUUID(),
                  digest: "a".repeat(64),
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow("Verified Studio asset version")
    expect((await commands.read(human, projectId)).revision).toBe(1)
  })

  it("binds original ordered commands without mutation and permits oversized transcript feedback", async () => {
    const { projectId, commands } = await fixture()
    const service = new StudioGenerationService(db)
    const beforeProject = await commands.read(human, projectId)
    const item = beforeProject.document.items.find((i) => i.id === "settle")
    if (!item?.speech) throw new FixtureError("Missing speech")
    const command = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "set-speech" as const,
          itemId: item.id,
          speech: { ...item.speech, text: "Long original spoken intent" },
        },
        {
          kind: "set-text" as const,
          itemId: item.id,
          text: "  Exact final\n ",
        },
      ],
    }
    const before = structuredClone(command),
      digest = studioHash(command.operations)
    const result = await service.validate(human, { command })
    expect(command).toEqual(before)
    expect(result.effectiveSpeech.operationsDigest).toBe(digest)
    if (result.effectiveSpeech.view !== "inline")
      throw new FixtureError("Expected inline")
    expect(result.effectiveSpeech.items[0].text).toBe("  Exact final\n ")
    const opposite = await service.validate(human, {
      command: { ...before, operations: [...before.operations].reverse() },
    })
    if (opposite.effectiveSpeech.view !== "inline")
      throw new FixtureError("Expected inline")
    expect(opposite.effectiveSpeech.items[0].text).toBe(
      "Long original spoken intent",
    )
    const oversized = {
      ...before,
      operations: Array.from({ length: 24 }, (_, index) => ({
        kind: "insert-item" as const,
        item: {
          ...structuredClone(item),
          id: `more-${index}`,
          speech: { ...item.speech!, text: "x".repeat(2000) },
        },
      })),
    }
    expect(await service.validate(human, { command: oversized })).toMatchObject(
      {
        valid: true,
        effectiveSpeech: {
          view: "unavailable",
          complete: false,
          speechItemCount: 25,
        },
      },
    )
    await expect(service.validate(null, { command })).rejects.toThrow(
      ForbiddenError,
    )
    await expect(
      service.validate(human, { command: { ...command, expectedRevision: 2 } }),
    ).rejects.toThrow("CONFLICT")
    expect(await commands.read(human, projectId)).toEqual(beforeProject)
  })

  it("serializes concurrent completions and replays the winning receipt exactly once", async () => {
    const { commands, projectId, attempt, manifest } = await fixture()
    const other = await commands.request(human, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    })
    const first = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: null,
    }
    const second = {
      ...first,
      idempotencyKey: randomUUID(),
      attemptId: other.attemptId,
    }
    const service = new StudioNarrationService(db)
    const results = await Promise.all([
      service.complete(worker, first),
      service.complete(worker, second),
    ])
    expect(results.map((r) => r.outcome).sort()).toEqual(["ACCEPTED", "STALE"])
    expect((await commands.read(human, projectId)).revision).toBe(2)
    expect(await service.complete(worker, first)).toEqual(results[0])
    expect(await service.complete(worker, second)).toEqual(results[1])
    expect(
      (await commands.read(human, projectId)).document.items.filter(
        (i) => i.kind === "audio",
      ),
    ).toHaveLength(1)
  })

  it("retains late narration after cancellation without attaching or changing the project", async () => {
    const { commands, projectId, attempt, manifest } = await fixture()
    const execution = new StudioExecutionService(db)
    const run = await execution.admit(human, {
      attemptId: attempt.attemptId,
      maxCostMicros: 1000,
    })
    await execution.cancel(human, run.id)
    await new StudioNarrationService(db).complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: attempt.attemptId,
      manifest: manifest.reference,
      costMicros: null,
    })
    expect((await commands.read(human, projectId)).revision).toBe(1)
    expect(
      await commands.readAttempt(human, projectId, attempt.attemptId!),
    ).toMatchObject({
      status: "CANCELLED",
      result: { manifest: manifest.reference, costMicros: null },
    })
    expect((await execution.read(human, run.id)).state).toBe("CANCELLED")
  })
})
