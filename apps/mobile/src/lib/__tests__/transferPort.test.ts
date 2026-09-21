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
  adoptStagedPath,
  buildExportFileName,
  buildExportRoot,
  buildExportTaskId,
  buildStagedExportPath,
  createTransferPort,
  exportStagingDir,
  isUnderExportRoot,
  normalizeUri,
  translateInterruptionForExport,
} from "../transferPort"

const ROOT = buildExportRoot("file:///docs/")

function segmentsOf(path: string): string[] {
  return path.split("/")
}

/** What the engine reports back: the destination it was given, scheme removed. */
function schemeless(uri: string): string {
  return uri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
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

describe("containment across the scheme boundary", () => {
  it("matches the engine's scheme-less location against the root", () => {
    const staged = `${ROOT}/v/Title.mp4`
    expect(isUnderExportRoot(schemeless(staged), ROOT)).toBe(true)
    expect(isUnderExportRoot(schemeless(ROOT), ROOT)).toBe(true)
    expect(isUnderExportRoot(schemeless(OFFLINE_ROOT), ROOT)).toBe(false)
  })

  it("adopts a scheme-less location in the root's URI form", () => {
    // The copy into the chosen folder needs the `file://` URI, so adoption
    // restores it.
    expect(adoptStagedPath(schemeless(`${ROOT}/v/Title.mp4`), ROOT)).toBe(
      `${ROOT}/v/Title.mp4`,
    )
    expect(adoptStagedPath(`${ROOT}/v/./Title.mp4`, ROOT)).toBe(
      `${ROOT}/v/Title.mp4`,
    )
  })

  it("adopts nothing that resolves outside the root", () => {
    expect(
      adoptStagedPath(schemeless(`${OFFLINE_ROOT}/v/f.mp4`), ROOT),
    ).toBeNull()
    expect(
      adoptStagedPath(`${ROOT}/../offline-downloads/v/f.mp4`, ROOT),
    ).toBeNull()
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
  const pause = jest.fn(async () => undefined)
  const resume = jest.fn(async () => undefined)
  const notifyBackgroundComplete = jest.fn()
  return {
    started,
    stop,
    pause,
    resume,
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
      pause,
      resume,
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

  it("signals background completion on an interrupted transfer", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})

    expect(engine.notifyBackgroundComplete).not.toHaveBeenCalled()
    engine.handlers().onInterruption({ state: "failed", keepBytes: true })
    await running

    expect(engine.notifyBackgroundComplete).toHaveBeenCalledTimes(1)
    expect(engine.notifyBackgroundComplete).toHaveBeenCalledWith(SPEC.id)
  })

  it("leaves a done transfer's signal to the staging path", async () => {
    // The adapter signals after the staging note lands, so the port must not
    // signal first and must not signal again for a late interruption.
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    engine.handlers().onDone({ location: SPEC.destination, bytesTotal: 4 })
    engine.handlers().onInterruption({ state: "canceled", keepBytes: false })
    await running

    expect(engine.notifyBackgroundComplete).not.toHaveBeenCalled()
  })

  it("contains a throwing sink on the interruption path", async () => {
    const engine = fakeEngine()
    const port = createTransferPort({
      ...engine.deps,
      notifyBackgroundComplete: () => {
        throw new Error("no such job")
      },
    })
    const running = port.runExportTransfer(SPEC, {})

    expect(() =>
      engine.handlers().onInterruption({ state: "failed", keepBytes: true }),
    ).not.toThrow()
    await expect(running).resolves.toMatchObject({ kind: "interrupted" })
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

/**
 * The viewer's pause. The native engine reports a pause AS a cancellation, and
 * the vendor suppresses that event on a HEALTHY pause — so the leak is a race a
 * device smoke test will not show. Only firing the event at a paused entry
 * proves the guard is there.
 */
describe("pause and resume (R24 revised)", () => {
  const paused = () => ({ kind: "userCancel" }) as const

  it("suspends without settling, so the run keeps its slot and its bytes", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    let settled = false
    const running = port
      .runExportTransfer(SPEC, {})
      .then((report) => ((settled = true), report))

    await port.pauseExportTransfer(SPEC.id)
    expect(engine.pause).toHaveBeenCalledWith(engine.task)

    // The engine's pause-as-cancel arrives; it must be swallowed.
    engine
      .handlers()
      .onInterruption({ state: "canceled", keepBytes: false }, undefined)
    await Promise.resolve()
    expect(settled).toBe(false)
    // A swallowed pause must NOT tell iOS the background job is finished.
    expect(engine.notifyBackgroundComplete).not.toHaveBeenCalled()

    await port.resumeExportTransfer(SPEC.id)
    expect(engine.resume).toHaveBeenCalledWith(engine.task)

    engine.handlers().onDone({ location: "/f.mp4", bytesTotal: 10 })
    await expect(running).resolves.toMatchObject({ kind: "done" })
  })

  it("anti-vacuous: the SAME interruption settles when NOT paused", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    engine
      .handlers()
      .onInterruption({ state: "canceled", keepBytes: false }, undefined)
    await expect(running).resolves.toMatchObject({
      kind: "interrupted",
      interruption: paused(),
    })
  })

  it("a real failure DURING a pause still settles — connectivity is the catch-all", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    await port.pauseExportTransfer(SPEC.id)
    // Not a userCancel, so the swallow must not apply.
    engine
      .handlers()
      .onInterruption({ state: "failed", keepBytes: true }, undefined)
    await expect(running).resolves.toMatchObject({ kind: "interrupted" })
  })

  it("stop while PAUSED settles the promise itself — the engine never will", async () => {
    // Without this the run awaits forever: the target's session slot, its
    // staging directory and the engine-config fence are all held for the life
    // of the process, and every retry answers already-exporting.
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    await port.pauseExportTransfer(SPEC.id)
    await port.stopExportTransfer(SPEC.id)
    await expect(running).resolves.toMatchObject({
      kind: "interrupted",
      interruption: paused(),
    })
    expect(engine.stop).toHaveBeenCalledWith(engine.task)
  })

  it("stop while RUNNING settles too, without waiting on an engine event", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    const running = port.runExportTransfer(SPEC, {})
    await port.stopExportTransfer(SPEC.id)
    await expect(running).resolves.toMatchObject({ kind: "interrupted" })
  })

  it("ignores pause and resume for an id it does not hold", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    await port.pauseExportTransfer("rawexport:missing")
    await port.resumeExportTransfer("rawexport:missing")
    expect(engine.pause).not.toHaveBeenCalled()
    expect(engine.resume).not.toHaveBeenCalled()
  })

  it("is idempotent: a second pause or resume does not re-ask the engine", async () => {
    const engine = fakeEngine()
    const port = createTransferPort(engine.deps)
    void port.runExportTransfer(SPEC, {})
    await port.pauseExportTransfer(SPEC.id)
    await port.pauseExportTransfer(SPEC.id)
    expect(engine.pause).toHaveBeenCalledTimes(1)
    await port.resumeExportTransfer(SPEC.id)
    await port.resumeExportTransfer(SPEC.id)
    expect(engine.resume).toHaveBeenCalledTimes(1)
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
