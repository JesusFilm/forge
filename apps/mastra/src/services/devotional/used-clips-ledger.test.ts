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
    expect(first.chapter.id).toBe("ch-1")
    await store.record(first.chapter.id, first.reservationId)

    const second = await store.pick(CHAPTERS)
    expect(second.chapter.id).toBe("ch-2")

    const ledger = await store.read()
    expect(ledger.used["ch-1"]).toEqual({
      lastUsedAt: "2026-05-01T00:00:00.000Z",
      count: 1,
    })
  })

  it("serializes overlapping stores so concurrent picks get different chapters", async () => {
    const storeA = createUsedClipsStore({
      filePath,
      now: () => new Date("2026-05-01T00:00:00Z"),
    })
    const storeB = createUsedClipsStore({
      filePath,
      now: () => new Date("2026-05-01T00:00:00Z"),
    })

    const [a, b] = await Promise.all([
      storeA.pick(CHAPTERS),
      storeB.pick(CHAPTERS),
    ])

    expect(new Set([a.chapter.id, b.chapter.id])).toEqual(
      new Set(["ch-1", "ch-2"]),
    )
    expect(a.reservationId).not.toBe(b.reservationId)
    expect((await storeA.read()).used["ch-1"].pendingUntil).toBeDefined()
  })

  it("release frees a reservation without recording a use", async () => {
    const store = createUsedClipsStore({
      filePath,
      now: () => new Date("2026-05-01T00:00:00Z"),
    })
    const first = await store.pick(CHAPTERS)
    await store.release(first.chapter.id, first.reservationId)
    const ledger = await store.read()
    expect(ledger.used["ch-1"].pendingUntil).toBeUndefined()
    expect(ledger.used["ch-1"].count).toBe(0)
    // Released → immediately pickable again.
    expect((await store.pick(CHAPTERS)).chapter.id).toBe("ch-1")
  })

  it("does not let a stale owner release a newer reservation", async () => {
    let current = new Date("2026-05-01T00:00:00Z")
    const oldStore = createUsedClipsStore({ filePath, now: () => current })
    const oldReservation = await oldStore.pick([CHAPTERS[0]!])

    current = new Date("2026-06-02T00:00:00Z")
    const newStore = createUsedClipsStore({ filePath, now: () => current })
    const newReservation = await newStore.pick([CHAPTERS[0]!])

    expect(newReservation.reservationId).not.toBe(oldReservation.reservationId)
    expect(
      await oldStore.release(
        oldReservation.chapter.id,
        oldReservation.reservationId,
      ),
    ).toBe(false)
    expect((await newStore.read()).used["ch-1"].reservationId).toBe(
      newReservation.reservationId,
    )
  })

  it("renews the current owner's reservation before an approval resumes", async () => {
    let current = new Date("2026-05-01T00:00:00Z")
    const store = createUsedClipsStore({ filePath, now: () => current })
    const reservation = await store.pick([CHAPTERS[0]!])

    current = new Date("2026-05-30T23:30:00Z")
    await store.renew(reservation.chapter.id, reservation.reservationId)

    expect((await store.read()).used["ch-1"].pendingUntil).toBe(
      "2026-06-29T23:30:00.000Z",
    )
    current = new Date("2026-06-01T01:00:00Z")
    await expect(store.pick([CHAPTERS[0]!])).rejects.toMatchObject({
      code: "no_available_chapter",
    })
  })

  it("does not rewrite a reservation that still has most of its lease", async () => {
    let current = new Date("2026-05-01T00:00:00Z")
    const store = createUsedClipsStore({ filePath, now: () => current })
    const reservation = await store.pick([CHAPTERS[0]!])
    const original = await store.read()

    current = new Date("2026-05-02T00:00:00Z")
    await store.renew(reservation.chapter.id, reservation.reservationId)

    expect(await store.read()).toEqual(original)
  })

  it("does not let a stale run renew a newer reservation", async () => {
    let current = new Date("2026-05-01T00:00:00Z")
    const store = createUsedClipsStore({ filePath, now: () => current })
    const stale = await store.pick([CHAPTERS[0]!])
    current = new Date("2026-06-02T00:00:00Z")
    const currentReservation = await store.pick([CHAPTERS[0]!])

    await expect(
      store.renew(stale.chapter.id, stale.reservationId),
    ).rejects.toMatchObject({ code: "reservation_mismatch" })
    expect((await store.read()).used["ch-1"].reservationId).toBe(
      currentReservation.reservationId,
    )
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
    const first = await store.pick([CHAPTERS[0]!])
    await store.record("ch-1", first.reservationId, "2026-05-01T00:00:00.000Z")
    const second = await store.pick([CHAPTERS[0]!])
    await store.record("ch-1", second.reservationId, "2026-05-02T00:00:00.000Z")
    const ledger = await store.read()
    expect(ledger.used["ch-1"].count).toBe(2)
    expect(ledger.used["ch-1"].lastUsedAt).toBe("2026-05-02T00:00:00.000Z")
  })

  it("fails closed when the ledger is corrupt", async () => {
    const store = createUsedClipsStore({ filePath })
    const reservation = await store.pick([CHAPTERS[0]!])
    await store.record("ch-1", reservation.reservationId) // create the file
    const { writeFile } = await import("node:fs/promises")
    await writeFile(filePath, "{ not json", "utf8")
    await expect(store.read()).rejects.toMatchObject({
      code: "corrupt_ledger",
    })
  })

  it("fails closed when parseable ledger data violates the schema", async () => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        used: {
          "ch-1": { lastUsedAt: "", count: -1 },
        },
      }),
      "utf8",
    )

    await expect(
      createUsedClipsStore({ filePath }).read(),
    ).rejects.toMatchObject({
      code: "corrupt_ledger",
    })
  })
})
