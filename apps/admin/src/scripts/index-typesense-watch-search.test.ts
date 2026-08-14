import { describe, expect, it, vi } from "vitest"
import {
  parseTypesenseWatchSearchIndexArgs,
  runGuardedTypesenseWatchSearchPublication,
  type TypesenseWatchSearchIndexLockClient,
  withTypesenseWatchSearchIndexLock,
} from "./index-typesense-watch-search"

function lockClient(results: boolean[]): TypesenseWatchSearchIndexLockClient {
  return {
    connect: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string) => ({
      rows: [
        sql.includes("pg_try_advisory_lock")
          ? { acquired: results.shift() }
          : { released: results.shift() },
      ],
    })),
    end: vi.fn(async () => undefined),
  }
}

describe("Typesense Watch Search index CLI", () => {
  it("reuses transcripts when no rebuild flag is supplied", () => {
    expect(parseTypesenseWatchSearchIndexArgs([])).toEqual({
      transcriptStrategy: "reuse",
    })
  })

  it("rebuilds transcripts only for the exact documented flag", () => {
    expect(
      parseTypesenseWatchSearchIndexArgs(["--rebuild-transcripts"]),
    ).toEqual({ transcriptStrategy: "rebuild" })
  })

  it("does not start publication when the candidate guard rejects", async () => {
    const publish = vi.fn(async () => "published")
    await expect(
      runGuardedTypesenseWatchSearchPublication("reuse", {
        assertCurrentPublicationAllowed: vi.fn(async () => {
          throw new Error("active candidate lease")
        }),
        publish,
      }),
    ).rejects.toThrow("active candidate lease")
    expect(publish).not.toHaveBeenCalled()
  })

  it("requires the exact v2 application qualification before publishing", async () => {
    const assertCurrentPublicationAllowed = vi.fn(async () => undefined)
    const publish = vi.fn(async () => "published")

    await expect(
      runGuardedTypesenseWatchSearchPublication("reuse", {
        assertCurrentPublicationAllowed,
        publish,
      }),
    ).resolves.toBe("published")

    expect(assertCurrentPublicationAllowed).toHaveBeenCalledWith({
      rebuildTranscripts: false,
      applicationRevision: "watch-search-candidate/v2",
    })
    expect(
      assertCurrentPublicationAllowed.mock.invocationCallOrder[0],
    ).toBeLessThan(publish.mock.invocationCallOrder[0]!)
  })

  it.each([
    { argv: ["--rebuild-transcript"] },
    { argv: ["--rebuild-transcripts=true"] },
    { argv: ["--rebuild-transcripts", "extra"] },
  ])(
    "rejects unknown arguments instead of silently reusing: $argv",
    ({ argv }) => {
      expect(() => parseTypesenseWatchSearchIndexArgs(argv)).toThrow(
        "Unknown Typesense Watch Search index argument",
      )
    },
  )

  it("holds a dedicated PostgreSQL advisory lock for the complete index run", async () => {
    const client = lockClient([true, true])
    const run = vi.fn(async () => "complete")

    await expect(
      withTypesenseWatchSearchIndexLock(run, {
        databaseUrl: "postgresql://forge:test@db:5432/forge",
        clientFactory: () => client,
      }),
    ).resolves.toBe("complete")

    expect(client.connect).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [expect.any(Number)],
    )
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock($1) AS released",
      [expect.any(Number)],
    )
    expect(client.end).toHaveBeenCalledOnce()
  })

  it("fails fast and closes the session when another index run owns the lock", async () => {
    const client = lockClient([false])
    const run = vi.fn(async () => undefined)

    await expect(
      withTypesenseWatchSearchIndexLock(run, {
        databaseUrl: "postgresql://forge:test@db:5432/forge",
        clientFactory: () => client,
      }),
    ).rejects.toThrow("already running")

    expect(run).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledOnce()
    expect(client.end).toHaveBeenCalledOnce()
  })

  it("releases the advisory lock when the index run fails", async () => {
    const client = lockClient([true, true])

    await expect(
      withTypesenseWatchSearchIndexLock(
        async () => {
          throw new Error("index failed")
        },
        {
          databaseUrl: "postgresql://forge:test@db:5432/forge",
          clientFactory: () => client,
        },
      ),
    ).rejects.toThrow("index failed")

    expect(client.query).toHaveBeenCalledTimes(2)
    expect(client.end).toHaveBeenCalledOnce()
  })
})
