import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  WatchSearchCurationManifestStaleError,
  exportWatchSearchCurations,
} from "./export-watch-search-curations"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe("exportWatchSearchCurations", () => {
  it("writes and verifies the deterministic PostgreSQL backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forge-curations-"))
    temporaryDirectories.push(directory)
    const destination = join(directory, "watch-search-curations.json")
    const prisma = {
      watchSearchCuration: { findMany: async () => [] },
    }

    await expect(
      exportWatchSearchCurations({ prisma: prisma as never, destination }),
    ).resolves.toEqual({ destination, curations: 0, aliases: 0 })
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual({
      schemaVersion: "watch-search-curations/v1",
      curations: [],
    })
    await expect(
      exportWatchSearchCurations({
        prisma: prisma as never,
        destination,
        check: true,
      }),
    ).resolves.toMatchObject({ curations: 0, aliases: 0 })

    await writeFile(destination, "{}\n", "utf8")
    await expect(
      exportWatchSearchCurations({
        prisma: prisma as never,
        destination,
        check: true,
      }),
    ).rejects.toBeInstanceOf(WatchSearchCurationManifestStaleError)
  })
})
