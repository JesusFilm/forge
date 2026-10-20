import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import { StudioAuthoringService } from "./index"
import { executeStudioDelegated } from "./delegated"
import { executeStudioInteractive } from "./interactive"
import { lockProject } from "./state"
import { StudioMuxJobs } from "./mux-jobs"

class StudioDeletionTestHarnessError extends Error {}

const url = env.STUDIO_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const owner = {
  id: randomUUID(),
  role: "ADMIN" as const,
  studioAuthority: "interactive" as const,
}
const document = {
  version: 1,
  title: "Deletion fixture",
  language: "en",
  runtimeVersion: "studio-test",
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 300,
  tracks: [],
  items: [],
  components: [],
  packRevisionIds: [],
}
suite("Project deletion against disposable Postgres", () => {
  let db: PrismaClient
  let commands: StudioAuthoringService
  beforeAll(async () => {
    if (url !== "postgresql://tataihono@127.0.0.1:55630/forge_studio_630_test")
      throw new StudioDeletionTestHarnessError(
        "Only the dedicated project-deletion test database is allowed",
      )
    db = new PrismaClient({ datasources: { db: { url } } })
    commands = new StudioAuthoringService(db)
    await db.user.create({
      data: {
        id: owner.id,
        email: `${owner.id}@example.test`,
        name: "Owner",
        role: "ADMIN",
        managerMembership: { create: { role: "OPERATOR" } },
      },
    })
  })
  afterAll(async () => {
    await db?.$disconnect()
  })
  async function create() {
    const projectId = randomUUID()
    await commands.create(owner, {
      projectId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      document,
    })
    return { projectId, expectedRevision: 1, idempotencyKey: randomUUID() }
  }
  it("removes discovery and reads while retaining history and an exact retry receipt", async () => {
    const input = await create()
    expect(
      (await commands.list(owner, { limit: 100 })).find(
        (row) => row.projectId === input.projectId,
      )?.canDelete,
    ).toBe(true)
    const result = await executeStudioInteractive(db, owner, {
      action: "delete",
      input,
    })
    expect(await commands.delete(owner, input)).toEqual(result)
    expect(
      await db.shortRevision.count({ where: { projectId: input.projectId } }),
    ).toBe(1)
    expect(
      await db.shortCommand.count({ where: { projectId: input.projectId } }),
    ).toBe(2)
    expect(
      (await commands.list(owner, { limit: 100 })).some(
        (row) => row.projectId === input.projectId,
      ),
    ).toBe(false)
    for (const read of [
      () => commands.read(owner, input.projectId),
      () => commands.history(owner, input.projectId),
      () => commands.readRevision(owner, input.projectId, 1),
      () => commands.attempts(owner, input.projectId),
      () => commands.approvals(owner, input.projectId),
    ])
      await expect(read()).rejects.toMatchObject({ name: "NotFoundError" })
    await expect(
      commands.apply(owner, {
        ...input,
        idempotencyKey: randomUUID(),
        operations: [{ kind: "set-metadata", title: "Revived" }],
      }),
    ).rejects.toThrow()
    await expect(
      commands.delete(owner, { ...input, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ name: "NotFoundError" })
    await expect(
      commands.delete(owner, { ...input, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })
  it("serializes simultaneous exact delete retries", async () => {
    const input = await create()
    const [first, second] = await Promise.all([
      commands.delete(owner, input),
      commands.delete(owner, input),
    ])
    expect(first).toEqual(second)
    expect(
      await db.shortCommand.count({
        where: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      }),
    ).toBe(1)
  })
  it("denies non-owners and service callers, including a stolen retry identity", async () => {
    const input = await create()
    const other = { ...owner, id: randomUUID() }
    expect(
      (await commands.list(other, { limit: 100 })).find(
        (row) => row.projectId === input.projectId,
      )?.canDelete,
    ).toBe(false)
    await expect(commands.delete(other, input)).rejects.toMatchObject({
      name: "ForbiddenError",
    })
    await expect(
      commands.delete({ id: null, role: "MANAGER_BACKEND" }, input),
    ).rejects.toMatchObject({ name: "ForbiddenError" })
    await commands.delete(owner, input)
    await expect(commands.delete(other, input)).rejects.toMatchObject({
      name: "ForbiddenError",
    })
  })
  it("rejects a stale revision without hiding the project", async () => {
    const input = await create()
    await expect(
      commands.delete(owner, { ...input, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect((await commands.read(owner, input.projectId)).revision).toBe(1)
  })
  it("requires edit consent for delegated deletion and preserves attribution", async () => {
    const input = await create()
    const caller = {
      sub: owner.id,
      authority: "delegated" as const,
      clientId: "claude",
      scopes: ["shorts:read"],
    }
    await expect(
      executeStudioDelegated(db, caller, { action: "delete", input }),
    ).rejects.toThrow("Insufficient Studio scope")
    const edited = { ...caller, scopes: ["shorts:edit"] }
    const result = await executeStudioDelegated(db, edited, {
      action: "delete",
      input,
    })
    expect(
      await executeStudioDelegated(db, edited, { action: "delete", input }),
    ).toEqual(result)
    const receipt = await db.shortCommand.findUniqueOrThrow({
      where: {
        projectId_idempotencyKey: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    })
    expect(receipt.actor).toMatchObject({
      id: owner.id,
      authority: "delegated",
      clientId: "claude",
    })
  })
  it("blocks live publication and allows deletion after unpublishing", async () => {
    const input = await create()
    await db.short.update({
      where: { id: input.projectId },
      data: { lifecycle: "PUBLISHED", firstPublishedAt: new Date() },
    })
    await expect(commands.delete(owner, input)).rejects.toMatchObject({
      code: "UNPUBLISH_REQUIRED",
    })
    await commands.unpublish(owner, { ...input, idempotencyKey: randomUUID() })
    await commands.delete(owner, input)
    expect(
      (await db.short.findUniqueOrThrow({ where: { id: input.projectId } }))
        .firstPublishedAt,
    ).not.toBeNull()
  })
  it("blocks queued/running work until it settles", async () => {
    const input = await create()
    const attempt = await db.shortAttempt.create({
      data: {
        id: randomUUID(),
        projectId: input.projectId,
        baseRevision: 1,
        kind: "RENDER",
        inputHash: "a".repeat(64),
        actor: { kind: "human", id: owner.id },
        instructions: [],
      },
    })
    await expect(commands.delete(owner, input)).rejects.toMatchObject({
      code: "PROJECT_BUSY",
    })
    await db.shortAttempt.update({
      where: { id: attempt.id },
      data: { status: "RUNNING" },
    })
    await expect(commands.delete(owner, input)).rejects.toMatchObject({
      code: "PROJECT_BUSY",
    })
    await db.shortAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED" },
    })
    await commands.delete(owner, input)
    expect(
      await db.shortAttempt.count({ where: { projectId: input.projectId } }),
    ).toBe(1)
  })
  it("blocks Mux processing after a render succeeds and skips deleted output in discovery", async () => {
    const input = await create()
    const attempt = await db.shortAttempt.create({
      data: {
        id: randomUUID(),
        projectId: input.projectId,
        baseRevision: 1,
        kind: "RENDER",
        status: "SUCCEEDED",
        inputHash: "a".repeat(64),
        actor: { kind: "human", id: owner.id },
        instructions: [],
      },
    })
    const job = await db.shortMuxJob.create({
      data: { attemptId: attempt.id, snapshot: {} },
    })
    await expect(commands.delete(owner, input)).rejects.toMatchObject({
      code: "PROJECT_BUSY",
    })
    await db.shortMuxJob.update({
      where: { id: job.id },
      data: { state: "FAILED" },
    })
    await commands.delete(owner, input)
    expect(
      (
        await new StudioMuxJobs(db).pending({
          id: null,
          role: "MANAGER_BACKEND",
        })
      ).some((row) => row.id === attempt.id),
    ).toBe(false)
  })
  it("requires calendar removal and rejects reassignment after deletion", async () => {
    const input = await create()
    const calendarId = randomUUID(),
      slotId = randomUUID()
    await db.shortCalendar.create({
      data: { id: calendarId, version: 1, settings: {} },
    })
    await db.shortPlanSlot.create({
      data: {
        id: slotId,
        calendarId,
        date: "2026-10-09",
        projectId: input.projectId,
      },
    })
    await expect(commands.delete(owner, input)).rejects.toMatchObject({
      code: "PROJECT_SCHEDULED",
    })
    await db.shortPlanSlot.update({
      where: { id: slotId },
      data: { projectId: null },
    })
    await commands.delete(owner, input)
    await expect(
      db.shortPlanSlot.update({
        where: { id: slotId },
        data: { projectId: input.projectId },
      }),
    ).rejects.toThrow()
  })
  it("keeps the tombstone and evidence immutable at the database boundary", async () => {
    const input = await create()
    await commands.delete(owner, input)
    await expect(
      db.short.update({
        where: { id: input.projectId },
        data: { deletedAt: null },
      }),
    ).rejects.toThrow()
    await expect(
      db.short.delete({ where: { id: input.projectId } }),
    ).rejects.toThrow()
    await expect(
      db.shortRevision.create({
        data: {
          projectId: input.projectId,
          number: 2,
          document,
          actor: { kind: "human", id: owner.id },
        },
      }),
    ).rejects.toThrow()
    await expect(
      db.shortAttempt.create({
        data: {
          id: randomUUID(),
          projectId: input.projectId,
          baseRevision: 1,
          kind: "RENDER",
          inputHash: "a".repeat(64),
          actor: { kind: "human", id: owner.id },
          instructions: [],
        },
      }),
    ).rejects.toThrow()
  })
  it("serializes deletion behind an edit rather than deleting a newer revision", async () => {
    const input = await create()
    let release!: () => void, locked!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const acquired = new Promise<void>((resolve) => {
      locked = resolve
    })
    const edit = db.$transaction(async (tx) => {
      await lockProject(tx, input.projectId)
      locked()
      await gate
      await tx.shortRevision.create({
        data: {
          projectId: input.projectId,
          number: 2,
          document,
          actor: { kind: "human", id: owner.id },
        },
      })
      await tx.short.update({
        where: { id: input.projectId },
        data: { currentRevision: 2 },
      })
    })
    await acquired
    const deletion = commands.delete(owner, input)
    const rejected = expect(deletion).rejects.toMatchObject({
      code: "CONFLICT",
    })
    release()
    await edit
    await rejected
    expect((await commands.read(owner, input.projectId)).revision).toBe(2)
  })
})
