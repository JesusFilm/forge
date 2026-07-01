/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { datadogRumMock, mockEnv, reactPluginMock } = vi.hoisted(() => {
  const datadogRumMock = {
    addAction: vi.fn(),
    addError: vi.fn(),
    init: vi.fn(),
  }
  const reactPlugin = { name: "react-plugin" }
  const reactPluginMock = vi.fn(() => reactPlugin)
  const mockEnv = {
    NEXT_PUBLIC_DATADOG_APPLICATION_ID: undefined as string | undefined,
    NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: undefined as string | undefined,
    NEXT_PUBLIC_DATADOG_SITE: "datadoghq.com",
    NEXT_PUBLIC_DATADOG_ENV: "development",
    NEXT_PUBLIC_DATADOG_VERSION: undefined as string | undefined,
  }

  return { datadogRumMock, mockEnv, reactPluginMock }
})

vi.mock("@datadog/browser-rum", () => ({
  datadogRum: datadogRumMock,
}))

vi.mock("@datadog/browser-rum-react", () => ({
  reactPlugin: reactPluginMock,
}))

vi.mock("@/env", () => ({
  env: mockEnv,
}))

import DatadogRum, {
  getDatadogRumInitConfig,
  reportDatadogRumAction,
  reportDatadogRumError,
} from "@/components/DatadogRum"

let container: HTMLDivElement
let root: Root

function resetMockEnv() {
  mockEnv.NEXT_PUBLIC_DATADOG_APPLICATION_ID = undefined
  mockEnv.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN = undefined
  mockEnv.NEXT_PUBLIC_DATADOG_SITE = "datadoghq.com"
  mockEnv.NEXT_PUBLIC_DATADOG_ENV = "development"
  mockEnv.NEXT_PUBLIC_DATADOG_VERSION = undefined
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMockEnv()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("DatadogRum", () => {
  it("does not initialize RUM when credentials are absent", async () => {
    act(() => {
      root.render(<DatadogRum />)
    })
    await flushEffects()

    expect(datadogRumMock.init).not.toHaveBeenCalled()
    expect(reactPluginMock).not.toHaveBeenCalled()
  })

  it("initializes RUM with Watch config when credentials are present", async () => {
    mockEnv.NEXT_PUBLIC_DATADOG_APPLICATION_ID = "rum-app-id"
    mockEnv.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN = "rum-client-token"
    mockEnv.NEXT_PUBLIC_DATADOG_ENV = "prod"
    mockEnv.NEXT_PUBLIC_DATADOG_VERSION = "abc123"

    act(() => {
      root.render(<DatadogRum />)
    })
    await flushEffects()

    expect(datadogRumMock.init).toHaveBeenCalledTimes(1)
    expect(datadogRumMock.init).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "rum-app-id",
        clientToken: "rum-client-token",
        site: "datadoghq.com",
        service: "forge-web",
        env: "prod",
        version: "abc123",
        sessionSampleRate: 50,
        sessionReplaySampleRate: 10,
        trackUserInteractions: true,
        trackResources: true,
        trackLongTasks: true,
        defaultPrivacyLevel: "mask-user-input",
        plugins: [{ name: "react-plugin" }],
      }),
    )
    expect(datadogRumMock.init.mock.calls[0]?.[0].allowedTracingUrls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          match: "https://api-gateway.central.jesusfilm.org/",
          propagatorTypes: ["tracecontext"],
        }),
        expect.objectContaining({
          match: "https://admin.jesusfilm.org/api/graphql",
          propagatorTypes: ["tracecontext"],
        }),
      ]),
    )
  })

  it("does not initialize twice on rerender", async () => {
    mockEnv.NEXT_PUBLIC_DATADOG_APPLICATION_ID = "rum-app-id"
    mockEnv.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN = "rum-client-token"

    act(() => {
      root.render(<DatadogRum />)
    })
    await flushEffects()
    act(() => {
      root.render(<DatadogRum />)
    })
    await flushEffects()

    expect(datadogRumMock.init).toHaveBeenCalledTimes(1)
  })

  it("returns null config when the application id or client token is missing", () => {
    expect(getDatadogRumInitConfig()).toBeNull()

    mockEnv.NEXT_PUBLIC_DATADOG_APPLICATION_ID = "rum-app-id"
    expect(getDatadogRumInitConfig()).toBeNull()

    mockEnv.NEXT_PUBLIC_DATADOG_APPLICATION_ID = undefined
    mockEnv.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN = "rum-client-token"
    expect(getDatadogRumInitConfig()).toBeNull()
  })

  it("reports caught segment-boundary errors to RUM", () => {
    const error = new Error("render failed")

    reportDatadogRumError(error, { boundary: "watch-page" })

    expect(datadogRumMock.addError).toHaveBeenCalledWith(error, {
      boundary: "watch-page",
    })
  })

  it("does not let Datadog reporting failures cascade", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    datadogRumMock.addError.mockImplementationOnce(() => {
      throw new Error("sdk failed")
    })

    expect(() =>
      reportDatadogRumError(new Error("render failed"), {
        boundary: "watch-locale",
      }),
    ).not.toThrow()

    expect(consoleError).toHaveBeenCalledWith(
      "[datadog-rum] failed to report error:",
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it("reports supplemental RUM actions", () => {
    reportDatadogRumAction("watch_search.result_clicked", {
      "watch_search.result_position": 3,
      "watch_search.search_request_id": "search_12345678",
    })

    expect(datadogRumMock.addAction).toHaveBeenCalledWith(
      "watch_search.result_clicked",
      {
        "watch_search.result_position": 3,
        "watch_search.search_request_id": "search_12345678",
      },
    )
  })

  it("does not let Datadog action failures cascade", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    datadogRumMock.addAction.mockImplementationOnce(() => {
      throw new Error("sdk failed")
    })

    expect(() =>
      reportDatadogRumAction("watch_search.result_clicked", {
        "watch_search.result_position": 3,
      }),
    ).not.toThrow()

    expect(consoleError).toHaveBeenCalledWith(
      "[datadog-rum] failed to report action:",
      expect.any(Error),
    )
    consoleError.mockRestore()
  })
})
