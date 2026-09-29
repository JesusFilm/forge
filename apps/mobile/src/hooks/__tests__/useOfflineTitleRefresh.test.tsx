/**
 * U7 (R4): the triggers of the offline title refresh. The pass itself is
 * `offlineTitleRefresh.test.ts`; this suite pins when the hook asks for one.
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

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../../i18n/catalogs.generated"), {
      ru: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["ru"],
    ),
)

import { StrictMode, act, createElement } from "react"
import type React from "react"

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import {
  OFFLINE_MANIFEST_VERSION,
  type OfflineDownloadRecord,
} from "../../lib/offlineManifest"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import {
  useOfflineTitleRefresh,
  type UseOfflineTitleRefreshOptions,
} from "../useOfflineTitleRefresh"

const RECORD: OfflineDownloadRecord = {
  version: OFFLINE_MANIFEST_VERSION,
  videoSlug: "a",
  dubDocumentId: "dub-a",
  renditionDocumentId: "rend-a",
  qualityLabel: "High",
  title: "English a",
  subtitleLanguageSlug: null,
  state: "downloaded",
  committedPath: "file:///offline/a/media.mp4",
  pendingPath: null,
  posterPath: null,
  bytesWritten: 1,
  totalBytes: 1,
}

const mounted: TestInstance[] = []

function render(initial: UseOfflineTitleRefreshOptions, fetchText: jest.Mock) {
  function Harness(props: UseOfflineTitleRefreshOptions) {
    useOfflineTitleRefresh(props, fetchText)
    return null
  }
  const wrap = (props: UseOfflineTitleRefreshOptions) =>
    createElement(
      StrictMode,
      null,
      createElement(Harness, props),
    ) as unknown as React.ReactElement
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(wrap(initial))
  })
  mounted.push(renderer)
  return {
    rerender: (next: UseOfflineTitleRefreshOptions) =>
      act(() => renderer.update(wrap(next))),
  }
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  })
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount())
  })
  resetLocaleStoreForTests()
})

function start(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  startLocaleSync()
}

describe("useOfflineTitleRefresh", () => {
  it("asks nothing before the records load, then refreshes a record from before U7", async () => {
    start("ru-RU")
    const fetchText = jest.fn(async () => null)
    const patchTitles = jest.fn(async () => undefined)
    const hook = render(
      { ready: false, records: [RECORD], patchTitles },
      fetchText,
    )
    await flush()
    expect(fetchText).not.toHaveBeenCalled()

    hook.rerender({ ready: true, records: [RECORD], patchTitles })
    await flush()
    expect(
      (fetchText.mock.calls as unknown as [string][]).map(([slug]) => slug),
    ).toEqual(["a"])
    expect(patchTitles).toHaveBeenCalledWith("a", { titleLocale: "ru" })
  })

  it("asks nothing under English for English titles, and refreshes after a change to Russian", async () => {
    start("en-US")
    const fetchText = jest.fn(async () => null)
    const patchTitles = jest.fn(async () => undefined)
    render({ ready: true, records: [RECORD], patchTitles }, fetchText)
    await flush()
    expect(fetchText).not.toHaveBeenCalled()

    mockGetLocales.mockReturnValue(phoneLocales("ru-RU"))
    await act(async () => {
      refreshLocale()
    })
    await flush()
    expect(fetchText).toHaveBeenCalled()
    expect(patchTitles).toHaveBeenCalledWith("a", { titleLocale: "ru" })
  })
})
