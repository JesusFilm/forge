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

    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({
      action: "write",
      path: "inputs/reflections/grace.md",
      actorId: "studio-user-1",
      requestId: "request-1",
      trustedEditorialRightsAssertion: true,
      preDigest: undefined,
      postDigest: sha256("Grace"),
    })
    expect(records[1]).toMatchObject({
      action: "write",
      preDigest: sha256("Grace"),
      postDigest: sha256("More grace"),
    })
    expect(records[2]).toMatchObject({
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
        actions.push(record.action)
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

    expect(records[0]).toMatchObject({
      actorId: "editor-2",
      requestId: "request-2",
      trustedEditorialRightsAssertion: true,
    })
    expect(records[1]).toMatchObject({
      actorId: "unknown",
      trustedEditorialRightsAssertion: false,
    })
  })
})
