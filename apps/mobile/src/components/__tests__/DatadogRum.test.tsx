/**
 * Pins the RUM configuration the provider actually hands to the SDK.
 *
 * `tsc` already rejects a mis-spelled key (TS2561, verified 2026-08-20), so
 * that is NOT what this suite guards. It guards the VALUE: deleting the
 * `longTaskThresholdMs` line, or setting it to 0, typechecks cleanly and
 * silently returns the JS thread to no long-task reporting at all.
 *
 * The assertions read a REAL `DatadogProviderConfiguration` — only
 * `DatadogProvider` itself is stubbed — so they pin what the SDK retains,
 * not what a mock was told to echo back.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see AccountSection.test.tsx).
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

jest.mock("../../env", () => ({
  env: {
    EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
    EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: undefined,
    EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: "pub-test-token",
    EXPO_PUBLIC_DATADOG_APPLICATION_ID: "test-application-id",
    EXPO_PUBLIC_DATADOG_SITE: undefined,
    EXPO_PUBLIC_DATADOG_ENV: undefined,
    EXPO_PUBLIC_DATADOG_VERSION: undefined,
    EXPO_PUBLIC_DATADOG_SESSION_SAMPLE_RATE: undefined,
    EXPO_PUBLIC_DATADOG_REPLAY_SAMPLE_RATE: undefined,
  },
}))

// Only `DatadogProvider` is replaced — it reaches native. Every configuration
// class stays real, which is the whole point of the suite.
jest.mock("@datadog/mobile-react-native", () => {
  const actual = jest.requireActual("@datadog/mobile-react-native")
  const captured: { current: unknown } = { current: undefined }
  return {
    ...actual,
    __captured: captured,
    DatadogProvider: ({
      configuration,
      children,
    }: {
      configuration: unknown
      children: unknown
    }) => {
      captured.current = configuration
      return children
    },
  }
})

// The provider arms a dev-only 10s init watchdog whose timer outlives the test
// run. Everything the assertions read — getDatadogRumConfig, the service name,
// the first-party host mapping — stays real.
jest.mock("../../lib/datadog", () => ({
  ...jest.requireActual("../../lib/datadog"),
  datadogInitWatchdog: { arm: jest.fn(), markInitialized: jest.fn() },
}))

jest.mock("@datadog/mobile-react-native-session-replay", () => ({
  SessionReplay: { enable: jest.fn().mockResolvedValue(undefined) },
  ImagePrivacyLevel: { MASK_NONE: "MASK_NONE" },
  TextAndInputPrivacyLevel: { MASK_ALL_INPUTS: "MASK_ALL_INPUTS" },
  TouchPrivacyLevel: { SHOW: "SHOW" },
}))

import { act } from "react"

import { MobileDatadogProvider } from "../DatadogRum"
import {
  TestRenderer,
  unmount,
  type NodePath,
  type NodeRequireLike,
} from "../../test-utils/rnTestRenderer"

/** The SDK's own bounds, from `utils/longTasksUtils`: below 100 or above 5000 is rewritten. */
const SDK_MIN_LONG_TASK_MS = 100
const SDK_MAX_LONG_TASK_MS = 5000

type CapturedRumConfiguration = {
  longTaskThresholdMs: number
  nativeLongTaskThresholdMs: number
}

async function renderAndCaptureRumConfiguration(): Promise<CapturedRumConfiguration> {
  const { __captured } = jest.requireMock("@datadog/mobile-react-native") as {
    __captured: { current: unknown }
  }
  __captured.current = undefined

  let renderer!: ReturnType<typeof TestRenderer.create>
  await act(async () => {
    renderer = TestRenderer.create(
      <MobileDatadogProvider>{null}</MobileDatadogProvider>,
    )
  })
  await unmount(renderer)

  const configuration = __captured.current as {
    rumConfiguration?: CapturedRumConfiguration
  }
  // A null config short-circuits the provider, so an unprovisioned env would
  // silently skip every assertion below.
  expect(configuration?.rumConfiguration).toBeDefined()
  return configuration.rumConfiguration as CapturedRumConfiguration
}

describe("MobileDatadogProvider — JS long task reporting", () => {
  it("reports a JS thread stall longer than 500ms", async () => {
    const rumConfiguration = await renderAndCaptureRumConfiguration()

    expect(rumConfiguration.longTaskThresholdMs).toBe(500)
  })

  it("picks a threshold the SDK passes through without rewriting it", async () => {
    const rumConfiguration = await renderAndCaptureRumConfiguration()

    expect(rumConfiguration.longTaskThresholdMs).toBeGreaterThanOrEqual(
      SDK_MIN_LONG_TASK_MS,
    )
    expect(rumConfiguration.longTaskThresholdMs).toBeLessThanOrEqual(
      SDK_MAX_LONG_TASK_MS,
    )
  })

  it("leaves native long task reporting on the SDK default", async () => {
    const rumConfiguration = await renderAndCaptureRumConfiguration()

    // Native stalls are already collected at 200ms; only the JS thread was dark.
    expect(rumConfiguration.nativeLongTaskThresholdMs).toBe(200)
  })
})
