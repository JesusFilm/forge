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

import { getTotalDiskCapacityAsync } from "expo-file-system/legacy"
import { totalDiskBytes } from "../offlineFileSystem"

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
