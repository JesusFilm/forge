/**
 * Pins the RUM configuration the provider hands to the SDK.
 *
 * `tsc` already rejects a mis-spelled key (TS2561, verified 2026-08-20), so that
 * is NOT what this suite guards. It guards the VALUE: deleting the
 * `longTaskThresholdMs` line, or setting it to 0, typechecks cleanly and
 * silently returns the JS thread to no long-task reporting at all.
 *
 * SCOPE. Only `DatadogProvider` is stubbed, so the captured object is a real
 * `RumConfiguration` and its `Object.assign` retention is genuinely exercised.
 * The suite stops there: `adaptLongTaskThreshold` runs later, inside
 * `DdSdkReactNative.initialize`, and nothing here reaches it.
 *
 * No `jest.mock("react", …)` preamble: since SDK 57 the package.json jest config
 * pins `^react$` and both runtimes globally (see `test-utils/rnTestRenderer`).
 */

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
import { TestRenderer, unmount } from "../../test-utils/rnTestRenderer"

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
})

/**
 * Not coverage of this change — a drift alarm on a vendor default it reasons
 * from. Reverting the whole feature leaves this green, by design: it fails only
 * when an SDK bump moves the default out from under the chosen 500.
 */
describe("Datadog SDK defaults this change relies on", () => {
  it("reports native long tasks at 200ms with no configuration", async () => {
    const rumConfiguration = await renderAndCaptureRumConfiguration()

    expect(rumConfiguration.nativeLongTaskThresholdMs).toBe(200)
  })
})
