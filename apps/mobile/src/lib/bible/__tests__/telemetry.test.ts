// The Bible reader's Datadog events (feat-551 KTD18, R37). A fake sink takes
// every log, so each case reads the exact context an event sends.

jest.mock("../../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { datadogLog } from "../../datadog"
import type { ChapterFetchResult } from "../repository/fetchChapter"
import {
  checkChapterNumbering,
  createReaderVisitTracker,
  reportTranslationChanged,
  reportTranslationDownload,
  resetReaderTelemetryForTests,
  withFetchFailureReport,
} from "../telemetry"

declare const __dirname: string
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: "utf8"): string
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[]
}>("fs")

const info = datadogLog.info as unknown as jest.Mock
const warn = datadogLog.warn as unknown as jest.Mock

/** Every log, as [event, context], in the order the sink took it. */
function logs(): [string, Record<string, unknown>][] {
  const all = [
    ...info.mock.invocationCallOrder.map((order, index) => ({
      order,
      call: info.mock.calls[index] as [string, Record<string, unknown>],
    })),
    ...warn.mock.invocationCallOrder.map((order, index) => ({
      order,
      call: warn.mock.calls[index] as [string, Record<string, unknown>],
    })),
  ]
  return all.sort((a, b) => a.order - b.order).map(({ call }) => call)
}

function events(name: string) {
  return logs()
    .filter(([event]) => event === name)
    .map(([, context]) => context)
}

beforeEach(() => {
  info.mockReset()
  warn.mockReset()
  resetReaderTelemetryForTests()
})

describe("a reader visit", () => {
  it("logs an open from a quote with reader_source quote", () => {
    const visit = createReaderVisitTracker()
    visit.focus("quote")
    expect(events("bible_reader.opened")).toEqual([{ reader_source: "quote" }])
  })

  it("logs an open from the tab with reader_source tab", () => {
    const visit = createReaderVisitTracker()
    visit.focus("tab")
    expect(events("bible_reader.opened")).toEqual([{ reader_source: "tab" }])
  })

  it("logs an open from a deep link with reader_source link", () => {
    const visit = createReaderVisitTracker()
    visit.focus("link")
    expect(events("bible_reader.opened")).toEqual([{ reader_source: "link" }])
  })

  it("ends at the blur with the count of different verses and no verse text", () => {
    const visit = createReaderVisitTracker()
    visit.showVerse("JHN.3.16")
    visit.focus("quote")
    visit.showVerse("JHN.3.17")
    visit.showVerse("JHN.3.16")
    visit.showVerse("JHN.3.18")
    visit.blur()

    expect(events("bible_reader.visit_ended")).toEqual([
      { reader_source: "quote", reader_verse_count: 3 },
    ])
    // A second blur is not a second end.
    visit.blur()
    expect(events("bible_reader.visit_ended")).toHaveLength(1)
  })

  it("counts no verse while nothing shows", () => {
    const visit = createReaderVisitTracker()
    visit.showVerse(null)
    visit.focus("tab")
    visit.blur()
    expect(events("bible_reader.visit_ended")).toEqual([
      { reader_source: "tab", reader_verse_count: 0 },
    ])
  })

  it("keeps one visit across a round trip to its own sheet", () => {
    const visit = createReaderVisitTracker()
    visit.showVerse("JHN.3.16")
    visit.focus("quote")
    visit.markSheetOpen()
    visit.blur()
    // The passage picker moves the reader while its sheet covers it.
    visit.showVerse("ROM.8.28")
    visit.focus("quote")
    visit.blur()

    expect(events("bible_reader.opened")).toHaveLength(1)
    expect(events("bible_reader.visit_ended")).toEqual([
      { reader_source: "quote", reader_verse_count: 2 },
    ])
  })

  it("counts no verse that shows while a sheet covers the reader, until it returns", () => {
    const visit = createReaderVisitTracker()
    visit.showVerse("JHN.3.16")
    visit.focus("tab")
    visit.markSheetOpen()
    visit.blur()
    visit.showVerse("JHN.3.17")
    visit.showVerse("JHN.3.18")
    visit.focus("tab")
    visit.blur()
    expect(events("bible_reader.visit_ended")).toEqual([
      { reader_source: "tab", reader_verse_count: 2 },
    ])
  })

  it("uses a sheet latch once: the next blur after the return ends the visit", () => {
    const visit = createReaderVisitTracker()
    visit.focus("tab")
    visit.markSheetOpen()
    visit.blur()
    visit.focus("tab")
    visit.blur()
    expect(events("bible_reader.visit_ended")).toHaveLength(1)
  })

  it("starts a new visit, with a new open, after a real blur", () => {
    const visit = createReaderVisitTracker()
    visit.showVerse("GEN.1.1")
    visit.focus("tab")
    visit.blur()
    visit.focus("tab")
    visit.blur()
    expect(events("bible_reader.opened")).toHaveLength(2)
    // The verse still on screen counts in the second visit too.
    expect(events("bible_reader.visit_ended")).toEqual([
      { reader_source: "tab", reader_verse_count: 1 },
      { reader_source: "tab", reader_verse_count: 1 },
    ])
  })

  it("ends at a real unmount, one tick later", async () => {
    const visit = createReaderVisitTracker()
    visit.focus("quote")
    visit.scheduleEnd()
    expect(events("bible_reader.visit_ended")).toHaveLength(0)
    await Promise.resolve()
    expect(events("bible_reader.visit_ended")).toHaveLength(1)
  })

  it("survives StrictMode's check remount: a setup cancels the scheduled end", async () => {
    const visit = createReaderVisitTracker()
    visit.focus("quote")
    visit.scheduleEnd()
    visit.focus("quote")
    visit.cancelEnd()
    await Promise.resolve()
    expect(events("bible_reader.opened")).toHaveLength(1)
    expect(events("bible_reader.visit_ended")).toHaveLength(0)
  })

  it("ignores a sheet mark while no visit runs", () => {
    const visit = createReaderVisitTracker()
    visit.markSheetOpen()
    visit.focus("tab")
    visit.blur()
    expect(events("bible_reader.visit_ended")).toHaveLength(1)
  })
})

describe("bible_reader.translation_changed", () => {
  it("logs a pick with the from and to translation ids", () => {
    reportTranslationChanged("picked", "BSB", "spa_rvr")
    expect(events("bible_reader.translation_changed")).toEqual([
      {
        reader_change: "picked",
        reader_from_translation_id: "BSB",
        reader_to_translation_id: "spa_rvr",
      },
    ])
  })

  it("names an unknown source translation none", () => {
    reportTranslationChanged("switched", null, "BSB")
    expect(events("bible_reader.translation_changed")).toEqual([
      {
        reader_change: "switched",
        reader_from_translation_id: "none",
        reader_to_translation_id: "BSB",
      },
    ])
  })
})

describe("bible_reader.download", () => {
  const GUE = { id: "gue_wbt", downloadBytes: 30454 }

  it.each([
    [{ status: "downloaded" } as const, "none"],
    [{ status: "cancelled" } as const, "none"],
    [{ status: "failed", reason: "no-space" } as const, "no-space"],
    [{ status: "failed", reason: "network" } as const, "network"],
  ])("logs %o with its reason and the catalog bytes", (outcome, reason) => {
    reportTranslationDownload(GUE, outcome)
    expect(events("bible_reader.download")).toEqual([
      {
        reader_translation_id: "gue_wbt",
        reader_outcome: outcome.status,
        reader_reason: reason,
        reader_download_bytes: 30454,
      },
    ])
  })
})

describe("bible_reader.chapter_fetch_failed", () => {
  const ADDRESS = {
    translationId: "gue_wbt",
    bookId: "JHN",
    chapter: 3,
  } as const

  it("logs the typed reason and the HTTP status, once per failed fetch", async () => {
    const fetch = withFetchFailureReport(async () => ({
      status: "failed",
      reason: "not-found",
      httpStatus: 404,
    }))
    const result = await fetch(ADDRESS)

    expect(result).toEqual({
      status: "failed",
      reason: "not-found",
      httpStatus: 404,
    })
    expect(events("bible_reader.chapter_fetch_failed")).toEqual([
      {
        reader_translation_id: "gue_wbt",
        reader_book: "JHN",
        reader_chapter: 3,
        reader_reason: "not-found",
        reader_http_status: 404,
      },
    ])
  })

  it("never logs the body, even when a failure carries one", async () => {
    // SYNTHETIC: fetchChapter never puts a body on a failure; this pins the
    // copy of named fields, so a spread of the result cannot leak one later.
    const body = "In the beginning God created the heavens and the earth."
    const fetch = withFetchFailureReport(
      async () =>
        ({
          status: "failed",
          reason: "malformed-text",
          body,
        }) as unknown as ChapterFetchResult,
    )
    await fetch(ADDRESS)

    const [context] = events("bible_reader.chapter_fetch_failed")
    expect(context).toEqual({
      reader_translation_id: "gue_wbt",
      reader_book: "JHN",
      reader_chapter: 3,
      reader_reason: "malformed-text",
      reader_http_status: 0,
    })
    expect(JSON.stringify(logs())).not.toContain("beginning")
  })

  it("logs nothing for a fetch that succeeds", async () => {
    const text = { chapter: { number: 3 } } as unknown as Extract<
      ChapterFetchResult,
      { status: "ok" }
    >["text"]
    const fetch = withFetchFailureReport(async () => ({ status: "ok", text }))
    await fetch(ADDRESS)
    expect(logs()).toHaveLength(0)
  })
})

describe("bible_reader.versification_mismatch", () => {
  it("logs nothing when the chapter ends where its system says (BSB John 3)", () => {
    checkChapterNumbering(
      { translationId: "BSB", bookId: "JHN", chapter: 3 },
      36,
    )
    expect(logs()).toHaveLength(0)
  })

  it("logs the mapped and the actual last verse when they differ", () => {
    checkChapterNumbering(
      { translationId: "BSB", bookId: "JHN", chapter: 3 },
      35,
    )
    expect(events("bible_reader.versification_mismatch")).toEqual([
      {
        reader_translation_id: "BSB",
        reader_book: "JHN",
        reader_chapter: 3,
        reader_system: "bsb",
        reader_mapped_last_verse: 36,
        reader_actual_last_verse: 35,
      },
    ])
  })

  it("reads the translation's own system for the book", () => {
    // ENGWEBP numbers Romans as rsc: its Romans 16 ends at 24, not eng's 27.
    checkChapterNumbering(
      { translationId: "ENGWEBP", bookId: "ROM", chapter: 16 },
      27,
    )
    const [context] = events("bible_reader.versification_mismatch")
    expect(context).toMatchObject({
      reader_system: "rsc",
      reader_actual_last_verse: 27,
    })
    expect(context?.reader_mapped_last_verse).not.toBe(27)
  })

  it("logs 0 as the mapped verse for a chapter its system does not have", () => {
    checkChapterNumbering(
      { translationId: "BSB", bookId: "JUD", chapter: 2 },
      5,
    )
    expect(events("bible_reader.versification_mismatch")).toEqual([
      expect.objectContaining({
        reader_mapped_last_verse: 0,
        reader_actual_last_verse: 5,
      }),
    ])
  })

  it("logs each chapter once per app process", () => {
    const address = { translationId: "BSB", bookId: "JHN", chapter: 3 } as const
    checkChapterNumbering(address, 35)
    checkChapterNumbering(address, 35)
    checkChapterNumbering({ ...address, chapter: 4 }, 1)
    expect(events("bible_reader.versification_mismatch")).toHaveLength(2)
  })
})

// KTD18: the reserved-attribute guard reads only an inline object literal, so
// a hoisted context or a second emit file leaves it blind with the suite green.
describe("the emit sites", () => {
  const SOURCE = fs.readFileSync(`${__dirname}/../telemetry.ts`, "utf8")
  const EMIT =
    /datadogLog\.(?:info|warn|error)\(\s*"([^"]+)",\s*\{([^{}]*)\}\s*,?\s*\)/g
  const KEY = /(?:^|,|\n)\s*([A-Za-z_$][\w$]*)\s*:/g

  function emits() {
    return Array.from(SOURCE.matchAll(EMIT)).map(([, name, body]) => ({
      name: name!,
      keys: Array.from(body!.matchAll(KEY)).map(([, key]) => key!),
    }))
  }

  it("sends the six KTD18 events, each through one inline literal", () => {
    // Anti-vacuous: every datadogLog call in the file is an inline emit.
    expect(emits()).toHaveLength(
      (SOURCE.match(/datadogLog\.(?:info|warn|error)\(/g) ?? []).length,
    )
    expect(
      emits()
        .map((emit) => emit.name)
        .sort(),
    ).toEqual([
      "bible_reader.chapter_fetch_failed",
      "bible_reader.download",
      "bible_reader.opened",
      "bible_reader.translation_changed",
      "bible_reader.versification_mismatch",
      "bible_reader.visit_ended",
    ])
  })

  it("prefixes every attribute with reader_", () => {
    for (const emit of emits()) {
      expect(emit.keys.length).toBeGreaterThan(0)
      for (const key of emit.keys) expect(key).toMatch(/^reader_/)
    }
  })

  it("is the only file under src/ or app/ that names a bible_reader event", () => {
    const root = `${__dirname}/../../../..`
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__" || entry.name === "node_modules")
          continue
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) {
          if (fs.readFileSync(full, "utf8").includes('"bible_reader.')) {
            hits.push(full.slice(root.length + 1))
          }
        }
      }
    }
    walk(`${root}/src`)
    walk(`${root}/app`)
    expect(hits).toEqual(["src/lib/bible/telemetry.ts"])
  })
})
