// Route-level RN rendering isn't set up in apps/mobile (no @testing-library/
// react-native), so the per-video sheet's load-bearing logic — the export
// request it builds and the latch that keeps one confirm from starting two
// exports — lives in src/lib/watchRawExportStart.ts and is unit-tested here.
// That is the pattern app/series/__tests__/download.test.tsx already uses.
//
// Those helpers are pure, so all of it stays green when the route stops calling
// them. The last describe reads app/watch/download.tsx and holds the call site.
import type {
  WatchDownload,
  WatchSubtitle,
} from "../../../src/lib/normalizeVideo"
import type { ExportFolder } from "../../../src/lib/rawExport"
import type { RawExportInput } from "../../../src/lib/rawExportAdapter"
import { startRawExportAfterPick } from "../../../src/lib/rawExportStart"
import type { RawExportStartOutcome } from "../../../src/lib/rawExportStart"
import {
  buildWatchRawExportRequest,
  startWatchRawExport,
  type WatchRawExportRequest,
  type WatchRawExportRequestInput,
} from "../../../src/lib/watchRawExportStart"

// The RN tsconfig carries no Node types, so the reader below is declared here
// rather than imported. Every other source-reading guard is plain JS.
declare function require(id: string): unknown
declare const __dirname: string

// ── Fixtures ────────────────────────────────────────────────────────

const RENDITION: WatchDownload = {
  documentId: "rendition-720",
  quality: "720p",
  size: "5242880",
  url: "https://cdn.example/the-birth-of-jesus-720.mp4",
}

const SUBTITLE: WatchSubtitle = {
  documentId: "subtitle-es",
  languageSlug: "spanish",
  languageName: "Spanish",
  languageBcp47: "es",
  vttSrc: "https://cdn.example/the-birth-of-jesus-es.vtt",
  primary: false,
  aiGenerated: false,
}

const FOLDER: ExportFolder = { uri: "file:///picked/Downloads/" }

const STARTED_AT = 1_700_000_000_000

function sheetSelection(
  over: Partial<WatchRawExportRequestInput> = {},
): WatchRawExportRequestInput {
  return {
    videoSlug: "the-birth-of-jesus",
    title: "The Birth of Jesus",
    rendition: RENDITION,
    wifiOnly: true,
    subtitle: SUBTITLE,
    startedAt: STARTED_AT,
    ...over,
  }
}

function requestOf(over: Partial<WatchRawExportRequestInput> = {}) {
  const request = buildWatchRawExportRequest(sheetSelection(over))
  if (!request) throw new Error("fixture builds no request")
  return request
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// ── The request the route sends ─────────────────────────────────────

describe("buildWatchRawExportRequest", () => {
  it("builds the whole export request from the sheet's selection", () => {
    expect(buildWatchRawExportRequest(sheetSelection())).toEqual({
      videoSlug: "the-birth-of-jesus",
      runId: `the-birth-of-jesus:${STARTED_AT}`,
      title: "The Birth of Jesus",
      rendition: {
        documentId: "rendition-720",
        qualityLabel: "720p",
        url: RENDITION.url,
        sizeBytes: 5242880,
      },
      wifiOnly: true,
      // R23 sends the hidden track by slug and URL only. An exact match is the
      // assertion: the display name and the document id must not travel.
      subtitleHiddenByRawMode: {
        languageSlug: "spanish",
        url: SUBTITLE.vttSrc,
      },
    })
  })

  it("carries an unreadable catalogue size as null, not NaN", () => {
    const request = requestOf({
      rendition: { ...RENDITION, size: "unknown" },
    })

    expect(request.rendition.sizeBytes).toBeNull()
  })

  it("sends no hidden track when the dub has no active subtitle", () => {
    expect(requestOf({ subtitle: null }).subtitleHiddenByRawMode).toBeNull()
  })

  it("refuses a rendition that names no URL", () => {
    // normalizeVideo defaults the URL to "", so this is a real admin shape.
    expect(
      buildWatchRawExportRequest(
        sheetSelection({ rendition: { ...RENDITION, url: "" } }),
      ),
    ).toBeNull()
  })

  it("refuses every export while R33's build switch is off", () => {
    jest.resetModules()
    jest.doMock("../../../src/lib/rawExportConstants", () => ({
      ...jest.requireActual<object>("../../../src/lib/rawExportConstants"),
      RAW_EXPORT_ENABLED: false,
    }))
    const disabled =
      require("../../../src/lib/watchRawExportStart") as typeof import("../../../src/lib/watchRawExportStart")

    expect(disabled.buildWatchRawExportRequest(sheetSelection())).toBeNull()

    jest.dontMock("../../../src/lib/rawExportConstants")
    jest.resetModules()
  })
})

// ── The re-entrancy latch (the reason this file exists) ─────────────

describe("startWatchRawExport", () => {
  it("runs nothing on a second confirm while the picker is open", async () => {
    const latch = { current: false }
    const picker = deferred<RawExportStartOutcome>()
    const runs: string[] = []
    const run = () => {
      runs.push("run")
      return picker.promise
    }

    const first = startWatchRawExport(latch, requestOf(), run)
    await expect(startWatchRawExport(latch, requestOf(), run)).resolves.toBe(
      "busy",
    )
    expect(runs).toEqual(["run"])

    picker.resolve("started")
    await expect(first).resolves.toBe("started")
  })

  it("anti-vacuous: the same two taps DO run twice without one latch", async () => {
    // Falsifies the test above: it is the shared latch that stops the second
    // run, not the fixture, and an unlatched sheet opens two pickers.
    const picker = deferred<RawExportStartOutcome>()
    const runs: string[] = []
    const run = () => {
      runs.push("run")
      return picker.promise
    }

    void startWatchRawExport({ current: false }, requestOf(), run)
    void startWatchRawExport({ current: false }, requestOf(), run)

    expect(runs).toEqual(["run", "run"])
    picker.resolve("started")
  })

  it("releases the latch when the viewer dismisses the picker", async () => {
    // The sheet stays open on a dismissal, so Confirm has to work again.
    const latch = { current: false }

    await expect(
      startWatchRawExport(latch, requestOf(), async () => "dismissed"),
    ).resolves.toBe("dismissed")
    expect(latch.current).toBe(false)
    await expect(
      startWatchRawExport(latch, requestOf(), async () => "started"),
    ).resolves.toBe("started")
  })

  it("holds the latch after a run starts, while the sheet dismisses", async () => {
    // The button is live for the whole dismissal animation, and a second
    // export of the same video dies silently in the session mutex.
    const latch = { current: false }
    await startWatchRawExport(latch, requestOf(), async () => "started")

    expect(latch.current).toBe(true)
    await expect(
      startWatchRawExport(latch, requestOf(), async () => "started"),
    ).resolves.toBe("busy")
  })

  it("releases the latch when the run throws, and surfaces the throw", async () => {
    const latch = { current: false }

    await expect(
      startWatchRawExport(latch, requestOf(), async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(latch.current).toBe(false)
  })

  it("never claims the latch for a request it refused to build", async () => {
    const latch = { current: false }
    const runs: string[] = []

    await expect(
      startWatchRawExport(latch, null, async () => {
        runs.push("run")
        return "started"
      }),
    ).resolves.toBe("unavailable")
    expect(runs).toEqual([])
    expect(latch.current).toBe(false)
  })
})

// ── The sequence the route composes ─────────────────────────────────

/** The route's own deps, over the real pick-then-dismiss-then-start helper. */
function routeRun(pickFolder: () => Promise<ExportFolder | null>) {
  const calls: string[] = []
  const exported: RawExportInput[] = []
  const run = (request: WatchRawExportRequest) =>
    startRawExportAfterPick({
      pickFolder: () => {
        calls.push("pick")
        return pickFolder()
      },
      dismiss: () => {
        calls.push("dismiss")
      },
      start: (folder) => {
        calls.push("export")
        exported.push({ ...request, folder })
      },
    })
  return { calls, exported, run }
}

describe("the composed raw branch", () => {
  it("dismisses the sheet, then exports the built request plus the folder", async () => {
    const latch = { current: false }
    const { calls, exported, run } = routeRun(async () => FOLDER)
    const request = requestOf()

    await expect(startWatchRawExport(latch, request, run)).resolves.toBe(
      "started",
    )
    expect(calls).toEqual(["pick", "dismiss", "export"])
    expect(exported).toEqual([{ ...request, folder: FOLDER }])
  })

  it("dismisses nothing and exports nothing when the viewer cancels the picker", async () => {
    const latch = { current: false }
    const { calls, exported, run } = routeRun(async () => null)

    await expect(startWatchRawExport(latch, requestOf(), run)).resolves.toBe(
      "dismissed",
    )
    expect(calls).toEqual(["pick"])
    expect(exported).toEqual([])
    expect(latch.current).toBe(false)
  })
})

// ── The call site ───────────────────────────────────────────────────

const { readFileSync } = require("fs") as {
  readFileSync: (file: string, encoding: string) => string
}

/**
 * The raw starter's body, brace-matched from its declaration. Indentation is
 * not the boundary: the starter sits inside the component and the fixtures
 * below do not, and a slice keyed on indent reads the wrong span for one.
 */
function rawStarterBody(source: string): string {
  const start = source.indexOf("const startRawExport =")
  if (start === -1) return ""
  const open = source.indexOf("{", start)
  if (open === -1) return ""
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1
    if (source[index] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  return source.slice(open)
}

/** The identifier the starter passes as the latch, or null when it passes none. */
function latchName(body: string): string | null {
  return /startWatchRawExport\(\s*([A-Za-z0-9_]+)\s*,/.exec(body)?.[1] ?? null
}

const UNGUARDED_STARTER = [
  "const startRawExport = async (rendition: WatchDownload) => {",
  "  const adapter = getRawExportAdapter()",
  "  await startRawExportAfterPick({",
  "    pickFolder: () => adapter.pickExportFolder(),",
  "  })",
  "}",
  "const onStartDownload = 1",
].join("\n")

describe("app/watch/download.tsx starts its export through the latch", () => {
  const route = readFileSync(`${__dirname}/../download.tsx`, "utf8")

  it("passes a ref it declares to startWatchRawExport", () => {
    const latch = latchName(rawStarterBody(route))

    expect(latch).not.toBeNull()
    expect(route).toContain(`const ${latch} = useRef(false)`)
  })

  it("builds its request through the tested builder, never inline", () => {
    const body = rawStarterBody(route)

    expect(body).toContain("buildWatchRawExportRequest(")
    expect(body).not.toContain("runId:")
  })

  it("positive control: the pre-fix starter is caught by both reads", () => {
    const body = rawStarterBody(UNGUARDED_STARTER)

    expect(body).not.toBe("")
    expect(latchName(body)).toBeNull()
    expect(body).not.toContain("buildWatchRawExportRequest(")
  })
})
