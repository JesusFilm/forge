import { createRequire } from "node:module"
// Pothos uses GraphQL CJS; use that same module instance for execution.
const { graphql } = createRequire(import.meta.url)(
  "graphql",
) as typeof import("graphql")
import { schema } from "@/graphql/schema"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { StudioAssetService } from "./assets"
import type { StudioAssetReference } from "@forge/studio-contracts"
import { StudioAuthoringService } from "./index"
import { publishStudioProject } from "./publication"

import { env } from "@/config/env"

class StudioTestHarnessError extends Error {}

const url = env.STUDIO_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const user = { id: "studio-test-operator", role: "ADMIN" as const }
const document = {
  version: 1,
  title: "Independent project",
  language: "en",
  runtimeVersion: "studio-proof-1",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 1800,
  tracks: [{ id: "main", kind: "visual" }],
  components: [],
  items: [],
  packRevisionIds: [],
}

suite("Studio command seam against disposable Postgres", () => {
  let db: PrismaClient
  let service: StudioAuthoringService
  const refs: Record<string, StudioAssetReference> = {}
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (
      parsed.hostname !== "127.0.0.1" ||
      !(
        parsed.pathname.startsWith("/forge_studio_454_test") ||
        (parsed.port === "55459" &&
          parsed.pathname === "/forge_studio_459_test") ||
        (parsed.port === "55455" &&
          parsed.pathname === "/forge_studio_455_test")
      )
    )
      throw new StudioTestHarnessError(
        "Only the dedicated loopback Studio test database is allowed",
      )
    db = new PrismaClient({ datasources: { db: { url } } })
    service = new StudioAuthoringService(db)
    for (const name of ["voice", "output", "manifest", "late"]) {
      refs[name] = (
        await new StudioAssetService(db).register(
          user,
          {
            filename: name + ".json",
            mimeType: "application/json",
            role: "archive",
            provenance: { status: "unknown", recorded: {} },
            idempotencyKey: randomUUID(),
          },
          Buffer.from(name),
          "LOCAL",
        )
      ).reference
    }
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  it("creates a standalone composition and reloads its immutable initial revision", async () => {
    const projectId = randomUUID()
    const result = await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    expect(result.revision).toBe(1)
    const saved = await service.read(user, projectId)
    expect(saved.document).toEqual(document)
    expect(saved.lifecycle).toBe("DRAFT")
    expect(saved.firstPublishedAt).toBeNull()
    expect(saved.actor).toEqual({ kind: "human", id: user.id })
  })
  it("serializes competing edits and makes a lost response safely retryable", async () => {
    const projectId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    const otherDb = new PrismaClient({ datasources: { db: { url } } })
    const other = new StudioAuthoringService(otherDb)
    const a = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "set-metadata", title: "First writer" }],
    }
    const b = {
      ...a,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "set-metadata", title: "Other writer" }],
    }
    try {
      const results = await Promise.allSettled([
        service.apply(user, a),
        other.apply(user, b),
      ])
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1)
      const winner = results[0].status === "fulfilled" ? a : b
      expect(await other.apply(user, winner)).toMatchObject({ revision: 2 })
      expect((await service.read(user, projectId)).document.title).toBe(
        winner.operations[0].title,
      )
      await expect(
        service.apply(user, { ...winner, operations: [] }),
      ).rejects.toBeDefined()
      expect(
        (await service.readRevision(user, projectId, 1)).document.title,
      ).toBe("Independent project")
    } finally {
      await otherDb.$disconnect()
    }
  })

  it("admits one generation attempt and retains stale completion without replacing edits", async () => {
    const projectId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    const request = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "GENERATION",
      instructions: [],
    }
    const [a, b] = await Promise.all([
      service.request(user, request),
      service.request(user, request),
    ])
    expect(a.attemptId).toBe(b.attemptId)
    await service.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "set-metadata", title: "Human edit" }],
    })
    const result = {
      assets: [refs.output!],
      costMicros: 0,
    }
    const completion = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: a.attemptId,
      status: "SUCCEEDED",
      result,
      operations: [{ kind: "set-metadata", title: "Stale generated title" }],
    }
    expect(
      await service.complete({ role: "SYSTEM", id: null }, completion),
    ).toMatchObject({ outcome: "STALE", revision: 2 })
    expect((await service.read(user, projectId)).document.title).toBe(
      "Human edit",
    )
    expect(
      await service.readAttempt(user, projectId, a.attemptId!),
    ).toMatchObject({ status: "STALE", result })
    expect(
      await service.complete({ role: "SYSTEM", id: null }, completion),
    ).toMatchObject({ outcome: "STALE" })
  })

  it("requires human script review, preserves it for visual edits, and invalidates it for spoken dependencies", async () => {
    const projectId = randomUUID()
    const reference = refs.voice!
    const speech = {
      text: "Spoken bridge",
      role: "bridge",
      suppressed: false,
      voice: reference,
      provider: "provider",
      model: "model",
      settings: {},
      pronunciation: reference,
    }
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        ...document,
        items: [
          {
            id: "text",
            kind: "text",
            trackId: "main",
            startFrame: 0,
            durationInFrames: 90,
            text: "Visible",
            properties: {},
            speech,
          },
        ],
      },
    })
    const request = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "NARRATION",
      instructions: [],
    }
    await expect(service.request(user, request)).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
    })
    const approval = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    }
    await expect(
      service.approve({ role: "MANAGER_BACKEND", id: null }, approval),
    ).rejects.toBeDefined()
    await service.approve(user, approval)
    await service.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "set-metadata", title: "Visual title" }],
    })
    expect(
      await service.request(user, { ...request, expectedRevision: 2 }),
    ).toHaveProperty("attemptId")
    await service.apply(user, {
      projectId,
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      operations: [
        {
          kind: "set-speech",
          itemId: "text",
          speech: { ...speech, suppressed: true },
        },
      ],
    })
    await expect(
      service.request(user, {
        ...request,
        expectedRevision: 3,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
  })

  it("serializes publication versus edits and permanently latches published then unpublished content", async () => {
    const projectId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    const render = await service.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    await service.complete(
      { role: "SYSTEM", id: null },
      {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        attemptId: render.attemptId,
        status: "SUCCEEDED",
        operations: [],
        result: {
          assets: [],
          costMicros: 0,
          manifest: refs.manifest!,
        },
      },
    )
    const approval = await service.approve(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "PUBLICATION",
      renderAttemptId: render.attemptId,
    })
    const input = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      approvalId: approval.approvalId,
      renderAttemptId: render.attemptId,
    }
    let entered!: () => void
    let release!: () => void
    const atGate = new Promise<void>((r) => {
      entered = r
    })
    const gateWait = new Promise<void>((r) => {
      release = r
    })
    const publishing = publishStudioProject(db, user, input, async () => {
      entered()
      await gateWait
    })
    await atGate
    const editing = service.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "set-metadata", title: "Too late" }],
    })
    release()
    const outcomes = await Promise.allSettled([publishing, editing])
    expect(outcomes[0].status).toBe("fulfilled")
    expect(outcomes[1]).toMatchObject({
      status: "rejected",
      reason: { code: "IMMUTABLE" },
    })
    const published = await service.read(user, projectId)
    expect(published.lifecycle).toBe("PUBLISHED")
    expect(published.firstPublishedAt).not.toBeNull()
    await service.unpublish(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    })
    expect(await service.read(user, projectId)).toMatchObject({
      lifecycle: "UNPUBLISHED",
      firstPublishedAt: published.firstPublishedAt,
    })
    await expect(
      service.apply(user, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        operations: [{ kind: "restore-document", document }],
      }),
    ).rejects.toMatchObject({ code: "IMMUTABLE" })
    await expect(
      service.request(user, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "GENERATION",
        instructions: [],
      }),
    ).rejects.toMatchObject({ code: "IMMUTABLE" })
    await expect(
      service.approve(user, {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        kind: "SCRIPT",
      }),
    ).rejects.toMatchObject({ code: "IMMUTABLE" })
    await expect(
      publishStudioProject(
        db,
        user,
        { ...input, idempotencyKey: randomUUID() },
        async () => {},
      ),
    ).rejects.toMatchObject({ code: "IMMUTABLE" })
    await expect(
      service.start(
        { role: "SYSTEM", id: null },
        {
          projectId,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          attemptId: render.attemptId,
          jobReference: "late-job",
        },
      ),
    ).rejects.toMatchObject({ code: "IMMUTABLE" })
    await expect(
      service.complete(
        { role: "SYSTEM", id: null },
        {
          projectId,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          attemptId: render.attemptId,
          status: "FAILED",
          operations: [],
          result: { assets: [], costMicros: 0 },
        },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      db.studioProject.update({
        where: { id: projectId },
        data: {
          lifecycle: "DRAFT",
          firstPublishedAt: null,
          unpublishedAt: null,
        },
      }),
    ).rejects.toBeDefined()
    await expect(
      db.studioProjectRevision.create({
        data: {
          projectId,
          number: 2,
          document,
          actor: { kind: "human", id: user.id },
        },
      }),
    ).rejects.toBeDefined()
    await expect(
      db.studioAttempt.update({
        where: { id: render.attemptId },
        data: { result: { assets: [] } },
      }),
    ).rejects.toBeDefined()
  })

  it("protects immutable snapshots at the database seam, even from direct updates", async () => {
    const projectId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    await expect(
      db.studioProjectRevision.update({
        where: { projectId_number: { projectId, number: 1 } },
        data: { document: { ...document, title: "Overwrite" } },
      }),
    ).rejects.toBeDefined()
    expect(
      (await service.readRevision(user, projectId, 1)).document.title,
    ).toBe("Independent project")
  })

  it("recovers an admitted worker job by stable identity and rejects re-binding", async () => {
    const projectId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    const admitted = await service.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    const input = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: admitted.attemptId,
      jobReference: "job-123",
    }
    const worker = { role: "SYSTEM" as const, id: null }
    await service.start(worker, input)
    const recovered = new StudioAuthoringService(db)
    expect(await recovered.start(worker, input)).toMatchObject({
      attemptId: admitted.attemptId,
    })
    expect(
      await recovered.readAttempt(user, projectId, admitted.attemptId!),
    ).toMatchObject({ status: "RUNNING", jobReference: "job-123" })
    await expect(
      recovered.start(worker, {
        ...input,
        idempotencyKey: randomUUID(),
        jobReference: "job-other",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect((await recovered.list(user, { limit: 100 })).length).toBeGreaterThan(
      0,
    )
  })

  it("invalidates script review when timeline movement changes spoken order", async () => {
    const projectId = randomUUID()
    const voice = refs.voice!
    const item = (id: string, startFrame: number, text: string) => ({
      id,
      kind: "text",
      trackId: "main",
      startFrame,
      durationInFrames: 90,
      text,
      properties: {},
      speech: {
        text,
        role: "bridge",
        suppressed: false,
        voice,
        provider: "provider",
        model: "model",
        settings: {},
        pronunciation: voice,
      },
    })
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document: {
        ...document,
        items: [item("a", 0, "First"), item("b", 90, "Second")],
      },
    })
    await service.approve(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    })
    await service.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { kind: "move-item", itemId: "a", trackId: "main", startFrame: 180 },
      ],
    })
    await expect(
      service.request(user, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        kind: "NARRATION",
        instructions: [],
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
  })

  it("exposes the same guarded GraphQL commands without an actor or public publish bypass", async () => {
    const projectId = randomUUID()
    const input = {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    }
    const source = `mutation($input: StudioCreateInput!) { createStudioProject(input: $input) { projectId revision } }`
    const denied = await graphql({
      schema,
      source,
      variableValues: { input },
      contextValue: { user: null, prisma: db },
    })
    expect(denied.errors).toBeDefined()
    const created = await graphql({
      schema,
      source,
      variableValues: { input },
      contextValue: { user, prisma: db },
    })
    expect(created.errors).toBeUndefined()
    expect(created.data?.createStudioProject).toEqual({
      projectId,
      revision: 1,
    })
    const backend = await graphql({
      schema,
      source: `mutation($input: StudioApproveInput!) { approveStudioProject(input: $input) { approvalId } }`,
      variableValues: {
        input: {
          projectId,
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
          kind: "SCRIPT",
        },
      },
      contextValue: { user: { role: "MANAGER_BACKEND", id: null }, prisma: db },
    })
    expect(backend.errors).toBeDefined()
    expect(
      schema.getMutationType()!.getFields().publishStudioProject,
    ).toBeUndefined()
    const missingRevision = await graphql({
      schema,
      source,
      variableValues: {
        input: { projectId, idempotencyKey: randomUUID(), document },
      },
      contextValue: { user, prisma: db },
    })
    expect(missingRevision.errors?.[0].message).toContain("expectedRevision")
  })
  it("rejects stale publication approval after an edit and rolls back failed catalog verification", async () => {
    const projectId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    const render = await service.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    await service.complete(
      { role: "SYSTEM", id: null },
      {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        attemptId: render.attemptId,
        status: "SUCCEEDED",
        operations: [],
        result: {
          assets: [],
          costMicros: 0,
          manifest: refs.manifest!,
        },
      },
    )
    const approval = await service.approve(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "PUBLICATION",
      renderAttemptId: render.attemptId,
    })
    const input = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      approvalId: approval.approvalId,
      renderAttemptId: render.attemptId,
    }
    await expect(
      publishStudioProject(db, user, input, async () => {
        throw new StudioTestHarnessError("Catalog not ready")
      }),
    ).rejects.toThrow("Catalog not ready")
    expect(await service.read(user, projectId)).toMatchObject({
      lifecycle: "DRAFT",
      firstPublishedAt: null,
    })
    await service.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [
        { kind: "set-metadata", title: "Still editable after approval" },
      ],
    })
    await expect(
      publishStudioProject(db, user, input, async () => {}),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(
      service.approve(user, {
        projectId,
        expectedRevision: 2,
        idempotencyKey: randomUUID(),
        kind: "PUBLICATION",
        renderAttemptId: render.attemptId,
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" })
  })

  it("recovers paginated revision, attempt, and approval history after reconnect", async () => {
    const projectId = randomUUID()
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    await service.approve(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "SCRIPT",
    })
    await service.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "GENERATION",
      instructions: [],
    })
    await service.apply(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      operations: [{ kind: "set-metadata", title: "Second" }],
    })
    const reconnectedDb = new PrismaClient({ datasources: { db: { url } } })
    try {
      const recovered = new StudioAuthoringService(reconnectedDb)
      expect(
        (await recovered.history(user, projectId, { limit: 1 }))[0],
      ).toMatchObject({ revision: 2, document: { title: "Second" } })
      expect(
        (
          await recovered.history(user, projectId, {
            limit: 1,
            beforeRevision: 2,
          })
        )[0],
      ).toMatchObject({
        revision: 1,
        document: { title: "Independent project" },
      })
      expect(await recovered.attempts(user, projectId, {})).toHaveLength(1)
      expect(await recovered.approvals(user, projectId, {})).toHaveLength(1)
    } finally {
      await reconnectedDb.$disconnect()
    }
  })

  it("retains late admitted work as stale after publication without modifying published content", async () => {
    const projectId = randomUUID()
    const worker = { role: "SYSTEM" as const, id: null }
    await service.create(user, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    const late = await service.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "GENERATION",
      instructions: [],
    })
    const render = await service.request(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "RENDER",
      instructions: [],
    })
    await service.complete(worker, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: render.attemptId,
      status: "SUCCEEDED",
      operations: [],
      result: {
        assets: [],
        costMicros: 0,
        manifest: refs.manifest!,
      },
    })
    const approval = await service.approve(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      kind: "PUBLICATION",
      renderAttemptId: render.attemptId,
    })
    await publishStudioProject(
      db,
      user,
      {
        projectId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
        approvalId: approval.approvalId,
        renderAttemptId: render.attemptId,
      },
      async () => {},
    )
    const published = await service.read(user, projectId)
    const completion = {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      attemptId: late.attemptId,
      status: "SUCCEEDED",
      operations: [{ kind: "set-metadata", title: "Late result" }],
      result: {
        assets: [refs.late!],
        costMicros: 100,
      },
    }
    expect(await service.complete(worker, completion)).toMatchObject({
      outcome: "STALE",
      revision: 1,
    })
    expect(
      await service.readAttempt(user, projectId, late.attemptId!),
    ).toMatchObject({ status: "STALE", result: completion.result })
    expect(await service.read(user, projectId)).toEqual(published)
    expect(
      await db.studioAssetUsage.findMany({
        where: {
          ownerType: "STUDIO_ATTEMPT",
          ownerId: late.attemptId,
          versionId: refs.late!.versionId,
        },
      }),
    ).toHaveLength(1)
    await service.unpublish(user, {
      projectId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
    })
    expect(
      await db.studioAssetUsage.findMany({
        where: {
          ownerType: "STUDIO_PUBLICATION",
          ownerId: projectId,
          versionId: refs.manifest!.versionId,
        },
      }),
    ).toHaveLength(1)
    expect(
      await new StudioAssetService(db).readBytes(user, refs.late!),
    ).toEqual(Buffer.from("late"))
    expect(await service.history(user, projectId)).toHaveLength(1)
  })
})
