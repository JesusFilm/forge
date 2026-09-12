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
    clearUser: vi.fn(),
    init: vi.fn(),
    setUser: vi.fn(),
  }
  const reactPlugin = { name: "react-plugin" }
  const reactPluginMock = vi.fn(() => reactPlugin)
  const mockEnv = {
    NEXT_PUBLIC_DATADOG_APPLICATION_ID: undefined as string | undefined,
    NEXT_PUBLIC_DATADOG_CLIENT_TOKEN: undefined as string | undefined,
    NEXT_PUBLIC_DATADOG_SITE: "datadoghq.com",
    NEXT_PUBLIC_DATADOG_ENV: "development",
    NEXT_PUBLIC_DATADOG_VERSION: undefined as string | undefined,
    // `src/lib/routes.ts` reads this at module evaluation time, and the v2
    // GA projection resolves canonical route context through it.
    NEXT_PUBLIC_CANONICAL_ORIGIN: "https://www.jesusfilm.org",
    NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2: undefined as boolean | undefined,
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
  clearDatadogRumUser,
  identifyDatadogRumUser,
  reportDatadogRumAction,
  reportDatadogRumError,
} from "@/components/DatadogRum"
import { WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION } from "@/lib/watch-search-analytics-contract"
import {
  flushWatchAnalyticsDispatches,
  setWatchAnalyticsFrameScheduler,
} from "@/lib/watch-analytics-contract"

let container: HTMLDivElement
let root: Root

function resetMockEnv() {
  mockEnv.NEXT_PUBLIC_DATADOG_APPLICATION_ID = undefined
  mockEnv.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN = undefined
  mockEnv.NEXT_PUBLIC_DATADOG_SITE = "datadoghq.com"
  mockEnv.NEXT_PUBLIC_DATADOG_ENV = "development"
  mockEnv.NEXT_PUBLIC_DATADOG_VERSION = undefined
  // Default OFF: every U1 allowlist fixture below therefore pins the v1
  // rollback path rather than whichever branch happened to be selected.
  mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = undefined
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMockEnv()
  window.gtag = undefined
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
  window.gtag = undefined
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

  it("initializes configured RUM with the no-prop Watch layout contract", async () => {
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

  it("projects only the allowlisted search-click parameters onto the GA wire", () => {
    const gtag = vi.fn()
    window.gtag = gtag
    // The real RUM context built by buildWatchSearchResultClickRumContext for a
    // watch_search.result_clicked action. Datadog is approved for all of it
    // (R18); GA is not (R13).
    const rumContext = {
      "watch_search.result_position": 3,
      "watch_search.result_source": "watch-search",
      "watch_search.result_type": "video",
      "watch_search.result_id": "5fc705b9-1b3b-4a58-abef-755b98457de6",
      "watch_search.result_slug": "jesus-is-brought-to-pilate",
      "watch_search.result_title": "Jesus Is Brought to Pilate",
      "watch_search.search_request_id": "search_12345678",
      "watch_search.route_language_slug": "english",
      "watch_search.search_language_slug": "urdu",
      "watch_search.search_language_english_name": "Urdu",
    }

    reportDatadogRumAction(WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION, rumContext)

    // R18: Datadog keeps the unchanged name and the full diagnostic context.
    expect(datadogRumMock.addAction).toHaveBeenCalledTimes(1)
    expect(datadogRumMock.addAction).toHaveBeenCalledWith(
      "watch_search.result_clicked",
      rumContext,
    )

    // R25: unchanged legacy wire name, unchanged event count.
    expect(gtag).toHaveBeenCalledTimes(1)
    // R13/R18: exact object equality, so any unallowlisted parameter fails.
    expect(gtag).toHaveBeenCalledWith("event", "search_result_clicked", {
      result_position: 3,
      result_source: "watch-search",
      result_type: "video",
    })

    const gaParams = gtag.mock.calls[0]?.[2] as Record<string, unknown>
    for (const forbidden of [
      "result_id",
      "result_slug",
      "result_title",
      "request_id",
      "search_request_id",
      "route_language_slug",
      "language_slug",
      "language_english_name",
      "search_language_english_name",
    ]) {
      expect(gaParams).not.toHaveProperty(forbidden)
    }
  })

  it("sends nothing to GA for an action with no registered GA projection", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    reportDatadogRumAction("watch_recommendation.card_clicked", {
      "watch_recommendation.item_id": "item-1",
      "watch_recommendation.position": 2,
    })

    expect(datadogRumMock.addAction).toHaveBeenCalledWith(
      "watch_recommendation.card_clicked",
      {
        "watch_recommendation.item_id": "item-1",
        "watch_recommendation.position": 2,
      },
    )
    // An action name that collides with Object.prototype must not resolve to a
    // projection either.
    reportDatadogRumAction("toString", { "watch_search.result_position": 1 })
    reportDatadogRumAction("constructor", {
      "watch_search.result_position": 1,
    })

    expect(gtag).not.toHaveBeenCalled()
  })

  it("still emits the GA search-click event when no allowlisted parameter is present", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    reportDatadogRumAction(WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION, {
      "watch_search.search_request_id": "search_12345678",
    })

    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith("event", "search_result_clicked", {})
  })

  it("identifies signed-in users in RUM without image data", () => {
    identifyDatadogRumUser({
      id: " auth-user-123 ",
      email: " viewer@example.test ",
      name: " Viewer Example ",
    })

    expect(datadogRumMock.setUser).toHaveBeenCalledWith({
      id: "auth-user-123",
      email: "viewer@example.test",
      name: "Viewer Example",
    })
  })

  it("clears the RUM user when the session is anonymous", () => {
    identifyDatadogRumUser(undefined)
    clearDatadogRumUser()

    expect(datadogRumMock.clearUser).toHaveBeenCalledTimes(2)
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

// -----------------------------------------------------------------------------
// v2 collector boundary (R18, R24, KTD4, KTD6).
//
// U1's allowlist stays the only gate on what leaves for Google. Under v2 the
// already-filtered projection is handed to the TYPED dispatcher instead of the
// v1 helper, so the v2 build never leaves a second, seamless, contextless
// dispatcher running beside the typed one.
// -----------------------------------------------------------------------------
describe("DatadogRum — GA projection under the v2 collector", () => {
  let frames: Array<() => void>

  /** Run every frame callback the seam has queued, the way a real paint would. */
  function runFrame() {
    for (const callback of frames.splice(0, frames.length)) callback()
  }

  beforeEach(() => {
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = true
    frames = []
    setWatchAnalyticsFrameScheduler((callback) => {
      frames.push(callback)
    })
    window.history.replaceState({}, "", "/watch/jesus.html/english.html")
  })

  afterEach(() => {
    setWatchAnalyticsFrameScheduler(null)
  })

  // R28/KTD9: the mode is a per-dispatch input. A search result click stays on
  // the client, so this call site chooses `deferred` and the dispatch must NOT
  // have reached `window.gtag` before the frame yields. Flipping the call site
  // to `immediate` fails this assertion, which is what makes the mode choice
  // load-bearing rather than decorative.
  it("defers the search-click dispatch to a paint yield", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    reportDatadogRumAction(WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION, {
      "watch_search.result_position": 3,
    })

    expect(datadogRumMock.addAction).toHaveBeenCalledTimes(1)
    expect(gtag).not.toHaveBeenCalled()

    runFrame()

    expect(gtag).toHaveBeenCalledTimes(1)
  })

  it("keeps Datadog's rich context while GA receives only the typed bounded projection (AE4)", () => {
    const gtag = vi.fn()
    window.gtag = gtag
    const rumContext = {
      "watch_search.result_position": 3,
      "watch_search.result_source": "watch-search",
      "watch_search.result_type": "video",
      "watch_search.result_id": "5fc705b9-1b3b-4a58-abef-755b98457de6",
      "watch_search.result_slug": "jesus-is-brought-to-pilate",
      "watch_search.result_title": "Jesus Is Brought to Pilate",
      "watch_search.search_request_id": "search_12345678",
      "watch_search.route_language_slug": "english",
      "watch_search.search_language_slug": "urdu",
      "watch_search.search_language_english_name": "Urdu",
    }

    reportDatadogRumAction(WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION, rumContext)
    flushWatchAnalyticsDispatches()

    // R18: Datadog is untouched by the collector flag.
    expect(datadogRumMock.addAction).toHaveBeenCalledTimes(1)
    expect(datadogRumMock.addAction).toHaveBeenCalledWith(
      "watch_search.result_clicked",
      rumContext,
    )

    // R25: unchanged legacy wire name, unchanged event count.
    expect(gtag).toHaveBeenCalledTimes(1)
    const [command, wireName, params] = gtag.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ]
    expect(command).toBe("event")
    expect(wireName).toBe("search_result_clicked")

    // R13/R20: a bounded position BUCKET, plus the canonical route context
    // every v2 event carries.
    expect(params).toMatchObject({
      event_contract_version: 2,
      watch_result_position_bucket: "2-3",
      watch_result_source: "watch-search",
      watch_result_type: "video",
      page_path: "/watch/jesus.html",
      watch_route_variant: "explicit_language_compatibility",
    })

    // R13/R19: nothing outside the allowlist survives the boundary.
    const serialized = JSON.stringify(params)
    for (const forbidden of [
      "5fc705b9-1b3b-4a58-abef-755b98457de6",
      "jesus-is-brought-to-pilate",
      "Jesus Is Brought to Pilate",
      "search_12345678",
      "Urdu",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("sends nothing to GA for an action with no registered projection", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    reportDatadogRumAction("watch_recommendation.card_clicked", {
      "watch_recommendation.item_id": "item-1",
    })
    flushWatchAnalyticsDispatches()

    expect(datadogRumMock.addAction).toHaveBeenCalledTimes(1)
    expect(gtag).not.toHaveBeenCalled()
  })

  it("does not fall through to the v1 helper when v2 is on", () => {
    const gtag = vi.fn()
    window.gtag = gtag

    reportDatadogRumAction(WATCH_SEARCH_RUM_RESULT_CLICKED_ACTION, {
      "watch_search.search_request_id": "search_12345678",
    })
    flushWatchAnalyticsDispatches()

    // v1 emits `("event", "search_result_clicked", {})` here. v2 emits the same
    // wire name WITH route context, so a single call carrying an empty params
    // object would mean the v1 helper had run under the v2 flag.
    expect(gtag).toHaveBeenCalledTimes(1)
    const params = gtag.mock.calls[0]?.[2] as Record<string, unknown>
    expect(params).toMatchObject({ event_contract_version: 2 })
    expect(params).not.toHaveProperty("watch_result_position_bucket")
  })
})
