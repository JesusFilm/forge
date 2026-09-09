/**
 * The sibling-root claim is about the REAL `OFFLINE_ROOT` expression, so this
 * suite pins against that constant. The two mocks below only give the offline
 * module a document directory and a log sink; nothing here exercises them.
 */
jest.mock("expo-file-system/legacy", () => ({
  deleteAsync: jest.fn(),
  documentDirectory: "file:///docs/",
  downloadAsync: jest.fn(),
  getFreeDiskStorageAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  getTotalDiskCapacityAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  moveAsync: jest.fn(),
}))
jest.mock("../datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import type {
  EngineTask,
  MediaDownloadHandlers,
  MediaDownloadSpec,
} from "../downloadEngine"
import { OFFLINE_ROOT } from "../offlineFileSystem"
import type { RawExportTransferSpec } from "../rawExport"
import {
  RAW_EXPORT_ID_PREFIX,
  RAW_EXPORT_MAX_FILENAME_LENGTH,
} from "../rawExportConstants"
import {
  buildExportFileName,
  buildExportRoot,
  buildExportTaskId,
  buildStagedExportPath,
  createTransferPort,
  exportStagingDir,
  isUnderExportRoot,
  normalizeUri,
  translateInterruptionForExport,
  translateInterruptionForOffline,
} from "../transferPort"

const ROOT = buildExportRoot("file:///docs/")

function segmentsOf(path: string): string[] {
  return path.split("/")
}

describe("export path namespace (KTD2)", () => {
  it("puts the export root beside the offline root, never inside it", () => {
    expect(ROOT).not.toBe(OFFLINE_ROOT)
    expect(isUnderExportRoot(OFFLINE_ROOT, ROOT)).toBe(false)
    expect(OFFLINE_ROOT.startsWith(`${ROOT}/`)).toBe(false)
    expect(ROOT.startsWith(`${OFFLINE_ROOT}/`)).toBe(false)
  })

  it("adds the missing separator when the document directory has none", () => {
    expect(buildExportRoot("file:///docs")).toBe(ROOT)
    expect(buildExportRoot(null).length).toBeGreaterThan(0)
  })

  it("keeps a staged path inside the export root for a hostile slug", () => {
    const staged = buildStagedExportPath({
      root: ROOT,
      videoSlug: "../../etc/passwd",
      title: "Jesus",
      fallbackName: "video",
    })
    expect(isUnderExportRoot(staged, ROOT)).toBe(true)
    expect(segmentsOf(staged)).not.toContain("..")
    expect(segmentsOf(staged)).not.toContain(".")
  })

  it("never lets a staged path normalize inside the offline root", () => {
    for (const slug of ["../offline-downloads/v", "..", ".", "a/../../b"]) {
      const staged = buildStagedExportPath({
        root: ROOT,
        videoSlug: slug,
        title: "../../escape",
        fallbackName: "video",
      })
      expect(normalizeUri(staged).startsWith(`${OFFLINE_ROOT}/`)).toBe(false)
      expect(isUnderExportRoot(staged, ROOT)).toBe(true)
    }
  })

  it("stages each target in its own directory under the root", () => {
    const dir = exportStagingDir(ROOT, "the-birth-of-jesus")
    expect(dir).toBe(`${ROOT}/the-birth-of-jesus`)
    expect(isUnderExportRoot(dir, ROOT)).toBe(true)
  })
})

describe("buildExportFileName (R34)", () => {
  it("derives a legible name from the video title", () => {
    expect(buildExportFileName("The Birth of Jesus", "video")).toBe(
      "The_Birth_of_Jesus.mp4",
    )
  })

  it("sanitizes and bounds an untrusted title", () => {
    const name = buildExportFileName(`../../${"A".repeat(400)} `, "video-slug")
    expect(name.length).toBeLessThanOrEqual(RAW_EXPORT_MAX_FILENAME_LENGTH)
    expect(name.endsWith(".mp4")).toBe(true)
    expect(name).not.toContain("/")
    expect(name).not.toContain(" ")
    expect(name.startsWith(".")).toBe(false)
  })

  it("falls back to the slug when the title is blank or absent", () => {
    expect(buildExportFileName("   ", "video-slug")).toBe("video-slug.mp4")
    expect(buildExportFileName(null, "video-slug")).toBe("video-slug.mp4")
  })

  it("never produces a hidden file from a dot-only title", () => {
    expect(buildExportFileName("...", "video").startsWith(".")).toBe(false)
  })
})

describe("normalizeUri", () => {
  it("resolves parent and current segments while keeping the scheme", () => {
    expect(normalizeUri("file:///docs/a/../b/./c")).toBe("file:///docs/b/c")
  })

  it("reports a path that climbs out of the root", () => {
    expect(isUnderExportRoot(`${ROOT}/a/../../offline-downloads/x`, ROOT)).toBe(
      false,
    )
    expect(isUnderExportRoot(`${ROOT}/a/b.mp4`, ROOT)).toBe(true)
  })
})

describe("export id namespace", () => {
  it("never hands the engine a bare slug", () => {
    const id = buildExportTaskId("the-birth-of-jesus")
    expect(id).toBe(`${RAW_EXPORT_ID_PREFIX}the-birth-of-jesus`)
    expect(id).not.toBe("the-birth-of-jesus")
  })
})

describe("interruption translation per consumer (KTD1)", () => {
  it("gives the offline consumer its paused state", () => {
    expect(translateInterruptionForOffline({ kind: "connectivity" })).toEqual({
      state: "paused",
      keepBytes: true,
    })
  })

  it("gives the export consumer one resume and then a failure", () => {
    expect(
      translateInterruptionForExport(
        { kind: "connectivity" },
        { resumesUsed: 0 },
      ),
    ).toEqual({ kind: "resume" })
    expect(
      translateInterruptionForExport(
        { kind: "connectivity" },
        { resumesUsed: 1 },
      ),
    ).toEqual({ kind: "terminate", outcome: "failed" })
    expect(
      translateInterruptionForExport(
        { kind: "wifiOnlyOnCellular" },
        { resumesUsed: 0 },
      ),
    ).toEqual({ kind: "terminate", outcome: "blocked" })
  })
})

/** A stand-in engine that records what it was asked to start and fires events. */
function fakeEngine() {
  const started: MediaDownloadSpec[] = []
  const holder: { handlers: MediaDownloadHandlers | null } = { handlers: null }
  const task = { id: "native-task" } as unknown as EngineTask
  const stop = jest.fn(async () => undefined)
  const notifyBackgroundComplete = jest.fn()
  return {
    started,
    stop,
    notifyBackgroundComplete,
    task,
    handlers: () => {
      if (!holder.handlers) throw new Error("no transfer started")
      return holder.handlers
    },
    deps: {
      start: (spec: MediaDownloadSpec, handlers: MediaDownloadHandlers) => {
        started.push(spec)
        holder.handlers = handlers
        return task
      },
      stop,
      notifyBackgroundComplete,
    },
  }
}

const SPEC: RawExportTransferSpec = {
  id: buildExportTaskId("v"),
  url: "https://cdn.example/high.mp4",
  destination: `${ROOT}/v/Title.mp4`,
  allowCellular: false,
}

describe("createTransferPort", () => {
  it("resolves with the location and byte total the engine reports", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const progress: number[] = []
    const running = port.runExportTransfer(SPEC, {
      onProgress: ({ bytesDownloaded }) => progress.push(bytesDownloaded),
    })

    expect(engine.started[0]).toMatchObject({
      id: SPEC.id,
      url: SPEC.url,
      destination: SPEC.destination,
      allowCellular: false,
    })
    engine.handlers().onProgress({ bytesDownloaded: 5, bytesTotal: 10 })
    engine.handlers().onDone({ location: SPEC.destination, bytesTotal: 10 })

    await expect(running).resolves.toEqual({
      kind: "done",
      stagedPath: SPEC.destination,
      bytesTotal: 10,
    })
    expect(progress).toEqual([5])
  })

  it("uses the raw interruption the engine supplies", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    engine.handlers().onInterruption(
      { state: "failed", keepBytes: true },
      {
        raw: { error: "boom", errorCode: 500 },
        interruption: { kind: "httpError", status: 500 },
      },
    )
    await expect(running).resolves.toEqual({
      kind: "interrupted",
      interruption: { kind: "httpError", status: 500 },
    })
  })

  it("falls back to the classification when no raw interruption arrives", async () => {
    const cases = [
      ["canceled", "userCancel"],
      ["paused", "connectivity"],
      ["failed", "integrity"],
    ] as const
    for (const [state, kind] of cases) {
      const engine = fakeEngine()
      const port = createTransferPort(engine.deps)
      const running = port.runExportTransfer(SPEC, {})
      engine.handlers().onInterruption({ state, keepBytes: false })
      await expect(running).resolves.toEqual({
        kind: "interrupted",
        interruption: { kind },
      })
    }
  })

  it("settles once, so a late event cannot replace the outcome", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    engine.handlers().onDone({ location: SPEC.destination, bytesTotal: 4 })
    engine.handlers().onInterruption({ state: "failed", keepBytes: true })
    await expect(running).resolves.toMatchObject({ kind: "done" })
  })

  it("stops a live transfer and ignores an unknown id", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    await port.stopExportTransfer(SPEC.id)
    expect(engine.stop).toHaveBeenCalledWith(engine.task)

    engine.handlers().onInterruption({ state: "canceled", keepBytes: false })
    await running
    engine.stop.mockClear()
    await port.stopExportTransfer("rawexport:nobody")
    expect(engine.stop).not.toHaveBeenCalled()
  })

  it("signals background completion and contains a throwing sink", () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    port.signalBackgroundCompletion(SPEC.id)
    expect(engine.notifyBackgroundComplete).toHaveBeenCalledWith(SPEC.id)

    const throwing = createTransferPort({
      ...engine.deps,
      notifyBackgroundComplete: () => {
        throw new Error("no such job")
      },
    })
    expect(() => throwing.signalBackgroundCompletion(SPEC.id)).not.toThrow()
  })
})

// The source-scan shape the repo's other guards use (homeHeroAndroidCompositing).
declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

describe("engine fence (KTD3)", () => {
  const fs = require("node:fs")
  const path = require("node:path")
  const files = ["transferPort.ts", "rawExportAdapter.ts"]

  it("never reaches the engine's global configure call", () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8")
      // Anti-vacuous control: the scan must have read real export code.
      expect(source.length).toBeGreaterThan(500)
      expect(source).toContain("export")
      expect(source).not.toContain("configureDownloadEngine")
      expect(source).not.toContain("setConfig")
    }
  })
})
