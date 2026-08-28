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
    const record = store.applyLanguageChanges.mock.calls[0][2]
    await record({
      id: "a",
      sourceKey: "cru",
      oldLanguage: null,
      newLanguage: "en",
    })
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

  it("does not allow the store transaction to finish when audit recording fails", async () => {
    const store = {
      applyLanguageChanges: vi.fn(async (_source, changes, record) => {
        await record({ ...changes[0], sourceKey: "cru" })
        return []
      }),
      revertLanguageChanges: vi.fn(),
    }
    await expect(
      applySourceChanges(
        store,
        "cru",
        [{ id: "a", oldLanguage: null, newLanguage: "en" }],
        async () => {
          throw new Error("audit unavailable")
        },
      ),
    ).rejects.toThrow("audit unavailable")
  })
})
