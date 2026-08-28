import { describe, expect, it, vi } from "vitest"

import { applySourceChanges, revertChanges } from "./language-maintenance.js"

describe("language maintenance guards", () => {
  it("writes one source transaction and logs committed rows only", async () => {
    const store = {
      applyLanguageChanges: vi
        .fn()
        .mockResolvedValue([
          { id: "a", sourceKey: "cru", oldLanguage: null, newLanguage: "en" },
        ]),
      revertLanguageChanges: vi.fn(),
    }
    const append = vi.fn()

    await applySourceChanges(
      store,
      "cru",
      [
        { id: "a", oldLanguage: null, newLanguage: "en" },
        { id: "b", oldLanguage: null, newLanguage: "fr" },
      ],
      append,
    )

    expect(store.applyLanguageChanges).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledOnce()
    expect(JSON.parse(append.mock.calls[0][0])).toMatchObject({ id: "a" })
  })

  it("reverts with the changelog new value as an optimistic guard", async () => {
    const store = {
      applyLanguageChanges: vi.fn(),
      revertLanguageChanges: vi.fn().mockResolvedValue(1),
    }
    await revertChanges(store, [
      { id: "a", sourceKey: "cru", oldLanguage: null, newLanguage: "en" },
    ])
    expect(store.revertLanguageChanges).toHaveBeenCalledWith([
      {
        id: "a",
        sourceKey: "cru",
        expectedLanguage: "en",
        restoreLanguage: null,
      },
    ])
  })
})
