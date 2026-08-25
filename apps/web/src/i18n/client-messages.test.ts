import { describe, expect, it } from "vitest"
import arabicMessages from "../../messages/ar.json"
import englishMessages from "../../messages/en.json"
import russianMessages from "../../messages/ru.json"
import chineseMessages from "../../messages/zh.json"
import {
  GLOBAL_CLIENT_MESSAGE_NAMESPACES,
  LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES,
  WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES,
  pickClientMessages,
} from "./client-messages"

describe("route-scoped client messages", () => {
  it("keeps the provider-owned global language picker translated", () => {
    const messages = pickClientMessages(
      englishMessages,
      GLOBAL_CLIENT_MESSAGE_NAMESPACES,
    )

    expect(GLOBAL_CLIENT_MESSAGE_NAMESPACES).toContain("LanguagePickerModal")
    expect(GLOBAL_CLIENT_MESSAGE_NAMESPACES).toContain("BetaTesterModal")
    expect(messages.LanguagePickerModal?.dialogTitle).toBe("Language")
    expect(messages.LanguagePickerModal?.notAvailable).toBe("Not available")
    expect(messages.LanguagePickerModal?.apply).toBe("Apply")
    expect(messages.BetaTesterModal?.trigger).toBe("Become a beta tester")
  })

  it.each([
    ["Russian", russianMessages, "Недоступно"],
    ["Arabic", arabicMessages, "غير متاح"],
    ["Chinese", chineseMessages, "暂不可用"],
  ])(
    "projects the localized unavailable badge status in %s",
    (_, catalog, expected) => {
      const messages = pickClientMessages(
        catalog,
        GLOBAL_CLIENT_MESSAGE_NAMESPACES,
      )

      expect(messages.LanguagePickerModal?.notAvailable).toBe(expected)
    },
  )

  it("keeps the language inventory collection switcher translated", () => {
    const messages = pickClientMessages(
      englishMessages,
      LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES,
    )

    expect(LANGUAGE_INVENTORY_CLIENT_MESSAGE_NAMESPACES).toContain(
      "LanguageCombobox",
    )
    expect(messages.LanguageCombobox?.selectLanguage).toBe("Select language")
  })

  it("keeps series collection downloads translated", () => {
    const messages = pickClientMessages(
      englishMessages,
      WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES,
    )

    expect(WATCH_CONTENT_CLIENT_MESSAGE_NAMESPACES).toContain(
      "CollectionDownloadModal",
    )
    expect(messages.SeriesPage?.downloadCollection).toBe("Download collection")
    expect(messages.CollectionDownloadModal?.dialogTitle).toBe(
      "Download collection",
    )
  })
})
