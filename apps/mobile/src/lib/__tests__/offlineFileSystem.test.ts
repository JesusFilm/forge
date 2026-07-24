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

import {
  deleteAsync,
  downloadAsync,
  getTotalDiskCapacityAsync,
} from "expo-file-system/legacy"
import { datadogLog } from "../datadog"
import { downloadToFile, totalDiskBytes } from "../offlineFileSystem"

describe("totalDiskBytes", () => {
  it("returns the device's total disk capacity", async () => {
    ;(getTotalDiskCapacityAsync as jest.Mock).mockResolvedValue(64_000_000_000)
    await expect(totalDiskBytes()).resolves.toBe(64_000_000_000)
  })

  it("returns 0 when the underlying call throws (unreadable)", async () => {
    ;(getTotalDiskCapacityAsync as jest.Mock).mockRejectedValue(
      new Error("boom"),
    )
    await expect(totalDiskBytes()).resolves.toBe(0)
  })
})

describe("downloadToFile", () => {
  const DEST = "file:///docs/offline-downloads/v/poster.jpg"
  beforeEach(() => {
    ;(downloadAsync as jest.Mock).mockReset()
    ;(deleteAsync as jest.Mock).mockReset().mockResolvedValue(undefined)
    ;(datadogLog.warn as jest.Mock).mockClear()
  })

  it("resolves and keeps the file on a 2xx response", async () => {
    ;(downloadAsync as jest.Mock).mockResolvedValue({ uri: DEST, status: 200 })
    await expect(
      downloadToFile("https://cdn/p.jpg", DEST),
    ).resolves.toBeUndefined()
    expect(deleteAsync).not.toHaveBeenCalled()
  })

  it("rejects and deletes the garbage file on a non-2xx response", async () => {
    // Regression: a variant-less Cloudflare URL 400s with a short "malformed URL"
    // body that downloadAsync writes to disk; it must not survive as a poster.
    ;(downloadAsync as jest.Mock).mockResolvedValue({ uri: DEST, status: 400 })
    await expect(downloadToFile("https://cdn/bad.jpg", DEST)).rejects.toThrow()
    expect(deleteAsync).toHaveBeenCalledWith(DEST, { idempotent: true })
    expect(datadogLog.warn).toHaveBeenCalledWith(
      "sidecar.download_bad_status",
      {
        status: 400,
      },
    )
  })

  it("rejects a 300 as non-2xx (pins the allow-list boundary)", async () => {
    ;(downloadAsync as jest.Mock).mockResolvedValue({ uri: DEST, status: 300 })
    await expect(
      downloadToFile("https://cdn/redir.jpg", DEST),
    ).rejects.toThrow()
    expect(deleteAsync).toHaveBeenCalledWith(DEST, { idempotent: true })
  })

  it("still rejects when cleanup of the garbage file itself fails", async () => {
    ;(downloadAsync as jest.Mock).mockResolvedValue({ uri: DEST, status: 404 })
    ;(deleteAsync as jest.Mock).mockRejectedValue(new Error("unlink failed"))
    await expect(downloadToFile("https://cdn/bad.jpg", DEST)).rejects.toThrow()
  })
})
