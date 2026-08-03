import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LocalFilesystem } from "@mastra/core/workspace"
import { afterEach, describe, expect, it } from "vitest"

import {
  AuditedFilesystem,
  runWithWorkspaceMutationContext,
  type WorkspaceMutationAuditRecord,
} from "./audited-filesystem"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

describe("AuditedFilesystem", () => {
  it("records actor, request, path, and pre/post digests for native mutations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devo-audit-"))
    temporaryDirectories.push(directory)
    const records: WorkspaceMutationAuditRecord[] = []
    const filesystem = new AuditedFilesystem(
      new LocalFilesystem({ basePath: directory, contained: true }),
      async (record) => {
        records.push(record)
      },
      () => ({
        actorId: "studio-user-1",
        requestId: "request-1",
        trustedEditorialRightsAssertion: true,
      }),
    )

    await filesystem.init()
    await filesystem.writeFile("inputs/reflections/grace.md", "Grace", {
      recursive: true,
    })
    await filesystem.writeFile("inputs/reflections/grace.md", "More grace")
    await filesystem.deleteFile("inputs/reflections/grace.md")

    expect(records).toHaveLength(6)
    const completed = records.filter((record) => record.phase === "completed")
    expect(completed).toHaveLength(3)
    expect(records.map((record) => record.phase)).toEqual([
      "intent",
      "completed",
      "intent",
      "completed",
      "intent",
      "completed",
    ])
    expect(completed[0]).toMatchObject({
      action: "write",
      path: "inputs/reflections/grace.md",
      actorId: "studio-user-1",
      requestId: "request-1",
      trustedEditorialRightsAssertion: true,
      preDigest: undefined,
      postDigest: sha256("Grace"),
    })
    expect(completed[1]).toMatchObject({
      action: "write",
      preDigest: sha256("Grace"),
      postDigest: sha256("More grace"),
    })
    expect(completed[2]).toMatchObject({
      action: "delete",
      preDigest: sha256("More grace"),
      postDigest: undefined,
    })
  })

  it("preserves copy, move, directory, read, and stat APIs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devo-audit-api-"))
    temporaryDirectories.push(directory)
    const actions: string[] = []
    const filesystem = new AuditedFilesystem(
      new LocalFilesystem({ basePath: directory, contained: true }),
      async (record) => {
        if (record.phase === "completed") actions.push(record.action)
      },
    )

    await filesystem.init()
    await filesystem.mkdir("inputs", { recursive: true })
    await filesystem.writeFile("inputs/a.txt", "a")
    await filesystem.copyFile("inputs/a.txt", "inputs/b.txt")
    await filesystem.moveFile("inputs/b.txt", "inputs/c.txt")

    expect(await filesystem.exists("inputs/c.txt")).toBe(true)
    expect((await filesystem.stat("inputs/c.txt")).size).toBe(1)
    expect(
      (await filesystem.readdir("inputs")).map((entry) => entry.name),
    ).toEqual(["a.txt", "c.txt"])
    expect(actions).toEqual(["mkdir", "write", "copy", "move"])
  })

  it("uses request-scoped Studio actor metadata without sharing it across calls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devo-audit-context-"))
    temporaryDirectories.push(directory)
    const records: WorkspaceMutationAuditRecord[] = []
    const filesystem = new AuditedFilesystem(
      new LocalFilesystem({ basePath: directory, contained: true }),
      async (record) => {
        records.push(record)
      },
    )
    await filesystem.init()

    await runWithWorkspaceMutationContext(
      {
        actorId: "editor-2",
        requestId: "request-2",
        trustedEditorialRightsAssertion: true,
      },
      () =>
        filesystem.writeFile("inputs/source.txt", "source", {
          recursive: true,
        }),
    )
    await filesystem.writeFile("runs/system.txt", "system", { recursive: true })

    const completed = records.filter((record) => record.phase === "completed")
    expect(completed[0]).toMatchObject({
      actorId: "editor-2",
      requestId: "request-2",
      trustedEditorialRightsAssertion: true,
    })
    expect(completed[1]).toMatchObject({
      actorId: "unknown",
      trustedEditorialRightsAssertion: false,
    })
  })

  it("fails before mutation when the durable intent cannot be recorded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devo-audit-fail-"))
    temporaryDirectories.push(directory)
    const filesystem = new AuditedFilesystem(
      new LocalFilesystem({ basePath: directory, contained: true }),
      async () => {
        throw new Error("audit unavailable")
      },
    )
    await filesystem.init()

    await expect(
      filesystem.writeFile("inputs/source.txt", "source", { recursive: true }),
    ).rejects.toThrow("audit unavailable")
    await expect(filesystem.exists("inputs/source.txt")).resolves.toBe(false)
  })

  it("retains a durable intent when completion recording fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "devo-audit-pending-"))
    temporaryDirectories.push(directory)
    const records: WorkspaceMutationAuditRecord[] = []
    const filesystem = new AuditedFilesystem(
      new LocalFilesystem({ basePath: directory, contained: true }),
      async (record) => {
        if (record.phase === "completed") throw new Error("audit unavailable")
        records.push(record)
      },
    )
    await filesystem.init()

    await expect(
      filesystem.writeFile("inputs/source.txt", "source", { recursive: true }),
    ).rejects.toThrow("audit unavailable")
    await expect(filesystem.exists("inputs/source.txt")).resolves.toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ phase: "intent", action: "write" })
  })
})
