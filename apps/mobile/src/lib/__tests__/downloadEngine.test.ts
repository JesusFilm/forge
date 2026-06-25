jest.mock("@kesha-antonov/react-native-background-downloader", () => ({
  setConfig: jest.fn(),
  createDownloadTask: jest.fn(),
  getExistingDownloadTasks: jest.fn(),
  completeHandler: jest.fn(),
  cleanup: jest.fn(),
}))

import { setConfig } from "@kesha-antonov/react-native-background-downloader"
import {
  __resetEngineConfigForTest,
  configureDownloadEngine,
} from "../downloadEngine"

const mockSetConfig = setConfig as jest.Mock

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
