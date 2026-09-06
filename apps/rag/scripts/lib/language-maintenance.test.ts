import { describe, expect, it, vi } from "vitest"

import {
  applySourceChanges,
  previewReverts,
  revertChanges,
} from "./language-maintenance.js"

describe("language maintenance guards", () => {
  it("writes one source transaction and logs committed rows only", async () => {
    const store = {
      applyLanguageChanges: vi
        .fn()
        .mockResolvedValue([
          { id: "a", sourceKey: "cru", oldLanguage: null, newLanguage: "en" },
        ]),
      revertLanguageChanges: vi.fn(),
      previewLanguageReverts: vi.fn(),
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
      { runId: "run-1" },
    )

    expect(store.applyLanguageChanges).toHaveBeenCalledOnce()
    expect(store.applyLanguageChanges).toHaveBeenCalledWith(
      "cru",
      expect.any(Array),
      { runId: "run-1" },
    )
    expect(append).toHaveBeenCalledOnce()
    expect(JSON.parse(append.mock.calls[0][0])).toMatchObject({ id: "a" })
  })

  it("reverts with the changelog new value as an optimistic guard", async () => {
    const store = {
      applyLanguageChanges: vi.fn(),
      revertLanguageChanges: vi.fn().mockResolvedValue(1),
      previewLanguageReverts: vi.fn(),
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

  it("previews the same optimistic guards without mutation", async () => {
    const store = {
      applyLanguageChanges: vi.fn(),
      revertLanguageChanges: vi.fn(),
      previewLanguageReverts: vi.fn().mockResolvedValue(1),
    }
    await expect(
      previewReverts(store, [
        { id: "a", sourceKey: "cru", oldLanguage: null, newLanguage: "en" },
      ]),
    ).resolves.toBe(1)
    expect(store.previewLanguageReverts).toHaveBeenCalledWith([
      { id: "a", sourceKey: "cru", expectedLanguage: "en" },
    ])
  })

  it("compensates committed rows when audit recording fails", async () => {
    const store = {
      applyLanguageChanges: vi
        .fn()
        .mockResolvedValue([
          { id: "a", sourceKey: "cru", oldLanguage: null, newLanguage: "en" },
        ]),
      revertLanguageChanges: vi.fn().mockResolvedValue(1),
      previewLanguageReverts: vi.fn(),
    }
    await expect(
      applySourceChanges(
        store,
        "cru",
        [{ id: "a", oldLanguage: null, newLanguage: "en" }],
        async () => {
          throw new Error("audit unavailable")
        },
        { runId: "run-2" },
      ),
    ).rejects.toThrow("audit unavailable")
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
