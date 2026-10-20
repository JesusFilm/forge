import { Platform } from "react-native"
import { traceHomeStartup } from "./startupTrace"

const originalFlag = process.env.EXPO_PUBLIC_TV_STARTUP_TRACE

afterEach(() => {
  jest.restoreAllMocks()
  if (originalFlag == null) delete process.env.EXPO_PUBLIC_TV_STARTUP_TRACE
  else process.env.EXPO_PUBLIC_TV_STARTUP_TRACE = originalFlag
})

it("does not log startup data in normal builds or on Apple TV", () => {
  const log = jest.spyOn(console, "info").mockImplementation(() => {})
  jest.replaceProperty(Platform, "OS", "android")
  delete process.env.EXPO_PUBLIC_TV_STARTUP_TRACE
  traceHomeStartup("root-mounted")
  process.env.EXPO_PUBLIC_TV_STARTUP_TRACE = "1"
  jest.replaceProperty(Platform, "OS", "ios")
  traceHomeStartup("root-mounted")
  expect(log).not.toHaveBeenCalled()
})

it("logs only a stage and timing numbers for an explicitly traced Android build", () => {
  jest.replaceProperty(Platform, "OS", "android")
  process.env.EXPO_PUBLIC_TV_STARTUP_TRACE = "1"
  const log = jest.spyOn(console, "info").mockImplementation(() => {})
  traceHomeStartup("snapshot-read", performance.now())
  expect(log).toHaveBeenCalledWith("[tv-startup]", expect.any(String))
  expect(JSON.parse(log.mock.calls[0][1])).toEqual({
    stage: "snapshot-read",
    clockMs: expect.any(Number),
    elapsedMs: expect.any(Number),
  })
})
