/**
 * The push text reads the catalog when it is asked for, never at load (R14).
 * A fixture `es` catalog holds a distinct text per key, so a swapped key or a
 * value frozen at import fails here.
 */

import {
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../../i18n/localeStore"
import { phoneLocales } from "../../../test-utils/uiLocaleFixture"
import {
  pushAnnouncementsChannelName,
  pushTestIdCopy,
  pushUnresolvableDestinationMessage,
} from "../copy"

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(
      jest.requireActual("../../../i18n/catalogs.generated"),
      {
        es: {
          Push: {
            announcementsChannelName: "Anuncios",
            unresolvableDestination: "No pudimos abrir ese anuncio.",
            testIdTitle: "ID de prueba",
            testIdHelp: "Comparte este ID con el equipo.",
            testIdRegistering: "Registrando este teléfono…",
            testIdNotificationsOff: "Las notificaciones están apagadas.",
            testIdClose: "Cerrar",
            testIdCopy: "Copiar ID",
          },
        },
      },
    ),
)
jest.mock("../../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../../i18n/pluralData.generated"),
      ["es"],
    ),
)

beforeEach(() => {
  resetLocaleStoreForTests()
  mockGetLocales.mockReset()
})

describe("the push text", () => {
  it("is the English catalog text before any language change", () => {
    expect(pushAnnouncementsChannelName()).toBe("Announcements")
    expect(pushUnresolvableDestinationMessage()).toBe(
      "We could not open that announcement. Here is the home screen.",
    )
    expect(pushTestIdCopy()).toEqual({
      title: "Notification test ID",
      help: "Share this ID with the team to receive test announcements on this phone.",
      registering: "Registering this phone…",
      notificationsOff:
        "Notifications are off for this phone. Turn them on in Settings to receive announcements.",
      close: "Close",
      copy: "Copy test ID",
    })
  })

  it("follows the UI language, and each field reads its own key", () => {
    mockGetLocales.mockReturnValue(phoneLocales("es-MX"))
    startLocaleSync()

    expect(pushAnnouncementsChannelName()).toBe("Anuncios")
    expect(pushUnresolvableDestinationMessage()).toBe(
      "No pudimos abrir ese anuncio.",
    )
    expect(pushTestIdCopy()).toEqual({
      title: "ID de prueba",
      help: "Comparte este ID con el equipo.",
      registering: "Registrando este teléfono…",
      notificationsOff: "Las notificaciones están apagadas.",
      close: "Cerrar",
      copy: "Copiar ID",
    })
  })
})
