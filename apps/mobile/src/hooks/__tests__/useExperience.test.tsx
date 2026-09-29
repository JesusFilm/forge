/** KTD16: the media routes read the root Experience, so a language change must
 *  never blank it while the new locale loads, or the section lookup misses and
 *  the route unmounts its player. StrictMode covers the epoch-change path. */

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

// Answers by locale; a locale with no entry is still loading.
const mockAnswers = new Map<string, unknown>()
const mockVariables: Record<string, unknown>[] = []
jest.mock("@apollo/client/react", () => ({
  useQuery: (
    _document: unknown,
    options: { variables: Record<string, unknown> },
  ) => {
    mockVariables.push(options.variables)
    const locale = options.variables.locale as string
    const answered = mockAnswers.has(locale)
    return {
      data: answered ? mockAnswers.get(locale) : undefined,
      loading: !answered,
      error: undefined,
      refetch: () => undefined,
    }
  },
}))
jest.mock("../../lib/queries", () => ({ GET_EXPERIENCE_BY_SLUG: {} }))

// `es` is a fixture catalog, so a phone change moves the locale epoch.
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
      es: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import { StrictMode, act } from "react"

import {
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import { useExperience } from "../useExperience"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const EASTER_EN = { slug: "easter", title: "Easter" }
const EASTER_EN_FALLBACK = { slug: "easter", title: "Easter (en fallback)" }
const EASTER_ES = { slug: "easter", title: "Pascua" }

let seen: (string | null)[] = []

function Probe() {
  const { experience } = useExperience({ slug: "easter" })
  seen.push((experience as { title?: string } | null)?.title ?? null)
  return null
}

let mounted: TestInstance | null = null

async function mount() {
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })
}

async function rerender() {
  await act(async () => {
    mounted?.update(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )
  })
}

async function changePhone(tag: string) {
  mockGetLocales.mockReturnValue(phoneLocales(tag))
  await act(async () => {
    refreshLocale()
  })
}

beforeEach(() => {
  seen = []
  mockAnswers.clear()
  mockVariables.length = 0
  resetLocaleStoreForTests()
  mockGetLocales.mockReturnValue(phoneLocales("en-US"))
  startLocaleSync()
  mockAnswers.set("en", { experienceBySlug: EASTER_EN })
})

afterEach(async () => {
  await act(async () => {
    mounted?.unmount()
  })
  mounted = null
  resetLocaleStoreForTests()
})

describe("useExperience across a live language change (U6)", () => {
  it("asks for the UI locale with the en variant beside it", async () => {
    await mount()
    await changePhone("es-MX")
    expect(mockVariables.at(-1)).toEqual({
      slug: "easter",
      locale: "es",
      isEnglish: false,
    })
  })

  it("keeps the last good Experience while the new locale loads", async () => {
    await mount()
    expect(seen.at(-1)).toBe("Easter")

    await changePhone("es-MX")

    // Never null in between, or the media route would lose its section.
    expect(seen).not.toContain(null)
    expect(seen.at(-1)).toBe("Easter")
  })

  it("renders the en variant when the new locale has none", async () => {
    await mount()
    await changePhone("es-MX")

    mockAnswers.set("es", {
      experienceBySlug: null,
      englishExperience: EASTER_EN_FALLBACK,
    })
    await rerender()

    expect(seen.at(-1)).toBe("Easter (en fallback)")
    expect(seen).not.toContain(null)
  })

  it("renders the new locale's own Experience once it resolves", async () => {
    await mount()
    await changePhone("es-MX")

    mockAnswers.set("es", {
      experienceBySlug: EASTER_ES,
      englishExperience: EASTER_EN,
    })
    await rerender()

    expect(seen.at(-1)).toBe("Pascua")
  })
})
