import { StrictMode, act, type ReactElement } from "react"

import { resetLocaleStoreForTests, startLocaleSync } from "../localeStore"
import { useLocaleResolutionLog } from "../useLocaleResolutionLog"
import { datadogLog } from "../../lib/datadog"
import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageTag: "ha-NG" }],
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))

function Root({ hydrated }: { hydrated: boolean }) {
  useLocaleResolutionLog(hydrated)
  return null
}

const strict = (hydrated: boolean): ReactElement => (
  <StrictMode>
    <Root hydrated={hydrated} />
  </StrictMode>
)

async function render(hydrated: boolean): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(strict(hydrated))
  })
  return renderer
}

beforeEach(() => {
  resetLocaleStoreForTests()
  startLocaleSync()
  jest.mocked(datadogLog.info).mockClear()
})

// StrictMode runs each mount effect twice, as a development build does.
it("logs once when the root starts hydrated", async () => {
  const renderer = await render(true)
  expect(datadogLog.info).toHaveBeenCalledTimes(1)
  await unmount(renderer)
})

// With cache persistence on, the root starts before hydration.
it("logs the resolution once, and only after hydration", async () => {
  const renderer = await render(false)
  expect(datadogLog.info).not.toHaveBeenCalled()

  await act(async () => {
    renderer.update(strict(true))
  })

  expect(datadogLog.info).toHaveBeenCalledTimes(1)
  expect(datadogLog.info).toHaveBeenCalledWith("ui_locale.resolved", {
    "ui_locale.resolved": "en",
    "ui_locale.requested": "ha-NG",
    "ui_locale.fallback": "english",
  })
  await unmount(renderer)
})
