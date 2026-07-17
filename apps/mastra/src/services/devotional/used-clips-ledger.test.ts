import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { JesusFilmChapter } from "./jesus-film-catalog"
import {
  chooseChapter,
  createUsedClipsStore,
  emptyLedger,
} from "./used-clips-ledger"

const CH = (index: number): JesusFilmChapter => ({
  index,
  id: `ch-${index}`,
  title: `Chapter ${index}`,
  start: "0:00:00",
})

const CHAPTERS = [CH(1), CH(2), CH(3)]

describe("chooseChapter", () => {
  it("prefers a never-used chapter, lowest index first", () => {
    expect(chooseChapter(CHAPTERS, {}).id).toBe("ch-1")
    expect(
      chooseChapter(CHAPTERS, {
        "ch-1": { lastUsedAt: "2026-01-01T00:00:00Z", count: 1 },
      }).id,
    ).toBe("ch-2")
  })

  it("falls back to least-recently-used when all are used", () => {
    const used = {
      "ch-1": { lastUsedAt: "2026-03-01T00:00:00Z", count: 1 },
      "ch-2": { lastUsedAt: "2026-01-01T00:00:00Z", count: 1 }, // oldest
      "ch-3": { lastUsedAt: "2026-02-01T00:00:00Z", count: 1 },
    }
    expect(chooseChapter(CHAPTERS, used).id).toBe("ch-2")
  })

  it("throws on an empty pool", () => {
    expect(() => chooseChapter([], {})).toThrow(/empty chapter pool/)
  })
})

describe("createUsedClipsStore", () => {
  let dir: string
  let filePath: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "used-clips-"))
    filePath = path.join(dir, "used-clips.json")
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("returns an empty ledger when the file does not exist", async () => {
    const store = createUsedClipsStore({ filePath })
    expect(await store.read()).toEqual(emptyLedger())
  })

  it("records a pick and advances the next pick past it", async () => {
    const store = createUsedClipsStore({
      filePath,
      now: () => new Date("2026-05-01T00:00:00Z"),
    })
    const first = await store.pick(CHAPTERS)
    expect(first.id).toBe("ch-1")
    await store.record(first.id)

    const second = await store.pick(CHAPTERS)
    expect(second.id).toBe("ch-2")

    const ledger = await store.read()
    expect(ledger.used["ch-1"]).toEqual({
      lastUsedAt: "2026-05-01T00:00:00.000Z",
      count: 1,
    })
  })

  it("reserves the picked chapter so a concurrent pick gets a different one", async () => {
    const store = createUsedClipsStore({
      filePath,
      now: () => new Date("2026-05-01T00:00:00Z"),
    })
    // Two picks with NO record between them (concurrent runs) must diverge.
    const a = await store.pick(CHAPTERS)
    const b = await store.pick(CHAPTERS)
    expect(a.id).toBe("ch-1")
    expect(b.id).toBe("ch-2")
    expect((await store.read()).used["ch-1"].pendingUntil).toBeDefined()
  })

  it("release frees a reservation without recording a use", async () => {
    const store = createUsedClipsStore({
      filePath,
      now: () => new Date("2026-05-01T00:00:00Z"),
    })
    const first = await store.pick(CHAPTERS)
    await store.release(first.id)
    const ledger = await store.read()
    expect(ledger.used["ch-1"].pendingUntil).toBeUndefined()
    expect(ledger.used["ch-1"].count).toBe(0)
    // Released → immediately pickable again.
    expect((await store.pick(CHAPTERS)).id).toBe("ch-1")
  })

  it("re-picks a chapter whose reservation has expired", () => {
    const used = {
      "ch-1": {
        lastUsedAt: "",
        count: 0,
        pendingUntil: "2026-05-01T00:00:01Z", // expired relative to `now` below
      },
    }
    // 1 hour after the reservation lapsed → ch-1 is available again.
    const chosen = chooseChapter(
      CHAPTERS,
      used,
      new Date("2026-05-01T01:00:00Z"),
    )
    expect(chosen.id).toBe("ch-1")
  })

  it("skips a chapter with a live reservation", () => {
    const used = {
      "ch-1": {
        lastUsedAt: "",
        count: 0,
        pendingUntil: "2026-05-02T00:00:00Z",
      },
    }
    const chosen = chooseChapter(
      CHAPTERS,
      used,
      new Date("2026-05-01T00:00:00Z"),
    )
    expect(chosen.id).toBe("ch-2")
  })

  it("increments count when the same chapter is recorded again", async () => {
    const store = createUsedClipsStore({ filePath })
    await store.record("ch-1", "2026-05-01T00:00:00.000Z")
    await store.record("ch-1", "2026-05-02T00:00:00.000Z")
    const ledger = await store.read()
    expect(ledger.used["ch-1"].count).toBe(2)
    expect(ledger.used["ch-1"].lastUsedAt).toBe("2026-05-02T00:00:00.000Z")
  })

  it("recovers from a corrupt ledger file instead of throwing", async () => {
    const store = createUsedClipsStore({ filePath })
    await store.record("ch-1") // create the file
    const { writeFile } = await import("node:fs/promises")
    await writeFile(filePath, "{ not json", "utf8")
    expect(await store.read()).toEqual(emptyLedger())
  })
})
