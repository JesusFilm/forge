jest.mock("@kesha-antonov/react-native-background-downloader", () => ({
  setConfig: jest.fn(),
  createDownloadTask: jest.fn(),
  getExistingDownloadTasks: jest.fn(),
  completeHandler: jest.fn(),
  cleanup: jest.fn(),
}))

import {
  createDownloadTask,
  setConfig,
} from "@kesha-antonov/react-native-background-downloader"
import {
  __resetEngineConfigForTest,
  configureDownloadEngine,
  pauseTask,
  resumeTask,
  startMediaDownload,
  stopTask,
} from "../downloadEngine"

const mockSetConfig = setConfig as jest.Mock
const mockCreate = createDownloadTask as jest.Mock

/** A fake native task that records the last handler per event and can fire them. */
function makeFakeTask() {
  const h: Record<string, (...a: unknown[]) => void> = {}
  const task = {
    begin(fn: (...a: unknown[]) => void) {
      h.begin = fn
      return task
    },
    progress(fn: (...a: unknown[]) => void) {
      h.progress = fn
      return task
    },
    done(fn: (...a: unknown[]) => void) {
      h.done = fn
      return task
    },
    error(fn: (...a: unknown[]) => void) {
      h.error = fn
      return task
    },
    start: jest.fn(),
    pause: jest.fn(() => Promise.resolve()),
    resume: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    fireError: (p: unknown) => h.error?.(p),
    fireDone: (p: unknown) => h.done?.(p),
  }
  return task
}

describe("configureDownloadEngine (idempotent)", () => {
  beforeEach(() => {
    mockSetConfig.mockClear()
    __resetEngineConfigForTest()
  })

  it("applies the native config on first call (cellular allowed when not wifi-only)", () => {
    configureDownloadEngine({ wifiOnly: false })
    expect(mockSetConfig).toHaveBeenCalledTimes(1)
    expect(mockSetConfig).toHaveBeenCalledWith(
      expect.objectContaining({ allowsCellularAccess: true }),
    )
  })

  // The native setConfig tears down + recreates the shared URLSession, which
  // cancels every in-flight download. A series fans out many downloads, so a
  // needless re-apply mid-series cancels the ones already running — the
  // "stops at N of M" bug. Re-applying an unchanged config must be a no-op.
  it("does NOT re-apply an unchanged config", () => {
    configureDownloadEngine({ wifiOnly: true })
    configureDownloadEngine({ wifiOnly: true })
    configureDownloadEngine({ wifiOnly: true })
    expect(mockSetConfig).toHaveBeenCalledTimes(1)
  })

  it("re-applies only when wifi-only actually changes", () => {
    configureDownloadEngine({ wifiOnly: true })
    configureDownloadEngine({ wifiOnly: false })
    expect(mockSetConfig).toHaveBeenCalledTimes(2)
    expect(mockSetConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowsCellularAccess: true }),
    )
  })
})

describe("task controls (pause / resume / stop / supersede)", () => {
  const spec = {
    id: "ep1",
    url: "https://x/f.m3u8",
    destination: "file:///d",
    allowCellular: true,
  }
  const handlers = {
    onProgress: jest.fn(),
    onDone: jest.fn(),
    onInterruption: jest.fn(),
  }

  beforeEach(() => jest.clearAllMocks())

  it("pauseTask calls native pause()", async () => {
    const t = makeFakeTask()
    mockCreate.mockReturnValue(t)
    await pauseTask(startMediaDownload(spec, handlers))
    expect(t.pause).toHaveBeenCalledTimes(1)
  })

  it("resumeTask calls native resume()", async () => {
    const t = makeFakeTask()
    mockCreate.mockReturnValue(t)
    await resumeTask(startMediaDownload(spec, handlers))
    expect(t.resume).toHaveBeenCalledTimes(1)
  })

  it("stopTask calls native stop()", async () => {
    const t = makeFakeTask()
    mockCreate.mockReturnValue(t)
    await stopTask(startMediaDownload(spec, handlers))
    expect(t.stop).toHaveBeenCalledTimes(1)
  })

  // Covers AE2: supersede neutralizes the task's own callbacks, so a late
  // terminal event fired by the stopped task reaches no handler.
  it("stopTask({supersede}) makes a later error/done inert", async () => {
    const t = makeFakeTask()
    mockCreate.mockReturnValue(t)
    const task = startMediaDownload(spec, handlers)
    await stopTask(task, { supersede: true })
    t.fireError({ errorCode: -999 })
    t.fireDone({ location: "file:///d", bytesTotal: 1 })
    expect(handlers.onInterruption).not.toHaveBeenCalled()
    expect(handlers.onDone).not.toHaveBeenCalled()
    expect(t.stop).toHaveBeenCalledTimes(1)
  })
})
