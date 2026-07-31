import { createHash } from "node:crypto"
import { Readable } from "node:stream"

import { describe, expect, it } from "vitest"

import {
  DevotionalRestoreAttestationSchema,
  importUsedClipsLedger,
  migrateDevotionalWorkspace,
  type DevotionalMigrationFilesystem,
  type DevotionalMigrationManifest,
} from "./migrate-devotional-workspace"

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function memoryFilesystem(
  initial: Record<string, string> = {},
): DevotionalMigrationFilesystem & { values: Map<string, Buffer> } {
  const values = new Map<string, Buffer>(
    Object.entries(initial).map(([path, value]) => [path, Buffer.from(value)]),
  )
  return {
    values,
    async exists(path) {
      return values.has(path)
    },
    async readFile(path) {
      const value = values.get(path)
      if (!value) throw new Error(`Missing ${path}`)
      return value
    },
    async writeFile(path, content, options) {
      if (!options.overwrite && values.has(path)) throw new Error("exists")
      values.set(path, Buffer.from(content))
    },
  }
}

function manifest(content: string): DevotionalMigrationManifest {
  return {
    version: 1,
    runId: "migration-20260731",
    createdAt: "2026-07-31T12:00:00.000Z",
    entries: [
      {
        sourcePath: "/legacy/grace.md",
        destinationPath: "/inputs/reflections/grace.md",
        sha256: digest(content),
        size: Buffer.byteLength(content),
        contentType: "text/markdown",
        kind: "authored-input",
      },
    ],
  }
}

function streamingMemoryFilesystem(initial: Record<string, string> = {}) {
  const filesystem = memoryFilesystem(initial)
  return {
    ...filesystem,
    async readStream(path: string) {
      return Readable.from(await filesystem.readFile(path))
    },
    async writeStream(
      path: string,
      content: Readable,
      options: { overwrite: false },
    ) {
      const chunks: Buffer[] = []
      for await (const chunk of content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      await filesystem.writeFile(path, Buffer.concat(chunks), {
        recursive: true,
        overwrite: options.overwrite,
        mimeType: "video/mp4",
      })
    },
  }
}

describe("migrateDevotionalWorkspace", () => {
  it("copies missing objects and makes an identical rerun a no-op", async () => {
    const source = memoryFilesystem({ "/legacy/grace.md": "Grace" })
    const destination = memoryFilesystem()

    await expect(
      migrateDevotionalWorkspace({
        manifest: manifest("Grace"),
        source,
        destination,
      }),
    ).resolves.toMatchObject({
      copied: ["/inputs/reflections/grace.md"],
      unchanged: [],
      conflicts: [],
      copyVerified: true,
      ready: false,
    })
    await expect(
      migrateDevotionalWorkspace({
        manifest: manifest("Grace"),
        source,
        destination,
      }),
    ).resolves.toMatchObject({
      copied: [],
      unchanged: ["/inputs/reflections/grace.md"],
      conflicts: [],
      copyVerified: true,
      ready: false,
    })
  })

  it("reports a different destination digest without overwriting", async () => {
    const source = memoryFilesystem({ "/legacy/grace.md": "Grace" })
    const destination = memoryFilesystem({
      "/inputs/reflections/grace.md": "Changed",
    })

    const report = await migrateDevotionalWorkspace({
      manifest: manifest("Grace"),
      source,
      destination,
    })

    expect(report).toMatchObject({
      copyVerified: false,
      ready: false,
      copied: [],
      unchanged: [],
    })
    expect(report.conflicts).toHaveLength(1)
    await expect(
      destination.readFile("/inputs/reflections/grace.md"),
    ).resolves.toEqual(Buffer.from("Changed"))
  })

  it("fails before writing when a source checksum is wrong", async () => {
    const source = memoryFilesystem({ "/legacy/grace.md": "Tampered" })
    const destination = memoryFilesystem()

    await expect(
      migrateDevotionalWorkspace({
        manifest: manifest("Grace"),
        source,
        destination,
      }),
    ).rejects.toThrow(/Source checksum mismatch/u)
    expect(destination.values).toHaveLength(0)
  })

  it("streams media migration without using the buffered fallback", async () => {
    const content = "media-bytes"
    const mediaManifest: DevotionalMigrationManifest = {
      ...manifest(content),
      entries: [
        {
          sourcePath: "/legacy/video.mp4",
          destinationPath: "/source-media/video.mp4",
          sha256: digest(content),
          size: Buffer.byteLength(content),
          contentType: "video/mp4",
          kind: "media",
        },
      ],
    }
    const source = streamingMemoryFilesystem({
      "/legacy/video.mp4": content,
    })
    let sourceReads = 0
    const readSourceStream = source.readStream
    source.readStream = async (path) => {
      sourceReads += 1
      return readSourceStream(path)
    }
    const destination = streamingMemoryFilesystem()

    await expect(
      migrateDevotionalWorkspace({
        manifest: mediaManifest,
        source,
        destination,
      }),
    ).resolves.toMatchObject({
      copied: ["/source-media/video.mp4"],
      copyVerified: true,
      ready: false,
    })
    await expect(
      destination.readFile("/source-media/video.mp4"),
    ).resolves.toEqual(Buffer.from(content))
    await expect(
      destination.readFile(
        "/_migrations/migration-20260731/source-media/video.mp4",
      ),
    ).resolves.toEqual(Buffer.from(content))
    expect(sourceReads).toBe(1)
  })

  it("rejects migration entries outside the area assigned to their kind", async () => {
    const source = memoryFilesystem({ "/legacy/grace.md": "Grace" })
    const badManifest = manifest("Grace")
    badManifest.entries[0]!.destinationPath = "/runs/grace.md"

    await expect(
      migrateDevotionalWorkspace({
        manifest: badManifest,
        source,
        destination: memoryFilesystem(),
      }),
    ).rejects.toThrow(/Invalid authored-input destination/u)
  })

  it("requires restore evidence independent from the migration manifest", () => {
    expect(() =>
      DevotionalRestoreAttestationSchema.parse({
        schemaVersion: 1,
        manifestDigest: "a".repeat(64),
        backupReference: "backup-2026-07-31",
        completedAt: "2026-07-31T12:00:00.000Z",
        verifiedBy: "operator@example.com",
        checks: {
          workspaceCrudSearch: true,
          hybridSearch: true,
          workerReadWrite: true,
          singleMastraReplica: true,
          runsDrained: true,
          legacyRefsReadable: true,
        },
      }),
    ).not.toThrow()
    expect(() =>
      DevotionalRestoreAttestationSchema.parse({
        schemaVersion: 1,
        manifestDigest: "a".repeat(64),
        backupReference: "backup-2026-07-31",
        completedAt: "2026-07-31T12:00:00.000Z",
        verifiedBy: "operator@example.com",
        checks: { workspaceCrudSearch: true },
      }),
    ).toThrow()
  })

  it("refuses to import a legacy ledger with an unresolved reservation", async () => {
    await expect(
      importUsedClipsLedger({
        database: {} as never,
        ledger: {
          version: 1,
          used: {
            "chapter-1": {
              count: 0,
              lastUsedAt: "",
              reservationId: "49cb0cc4-2fdd-4edb-a1f6-d90664d2c885",
            },
          },
        },
      }),
    ).rejects.toThrow(/unresolved reservation/u)
  })
})
