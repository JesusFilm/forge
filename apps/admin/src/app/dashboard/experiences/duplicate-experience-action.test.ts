import { describe, expect, it, vi } from "vitest"

import {
  ExperienceDuplicationError,
  ForbiddenError,
  NotFoundError,
} from "@/services/errors"
import { duplicateExperienceForEditor } from "./duplicate-experience-action"

const user = {
  id: "editor-1",
  role: "EDITOR" as const,
}

describe("duplicateExperienceForEditor", () => {
  it("routes to the selected locale and revalidates the list", async () => {
    const revalidate = vi.fn()
    const duplicate = vi.fn().mockResolvedValue({
      id: "copy-1",
      locales: [{ locale: "fr" }, { locale: "en" }],
    })

    await expect(
      duplicateExperienceForEditor({
        duplicate,
        user,
        sourceExperienceId: "source-1",
        selectedLocale: "en",
        revalidate,
      }),
    ).resolves.toEqual({
      ok: true,
      href: "/dashboard/experiences/copy-1?locale=en",
    })
    expect(duplicate).toHaveBeenCalledWith({
      input: { id: "source-1" },
      user,
    })
    expect(revalidate).toHaveBeenCalledOnce()
  })

  it("falls back to the first copied locale", async () => {
    const duplicate = vi.fn().mockResolvedValue({
      id: "copy-1",
      locales: [{ locale: "fr" }],
    })

    await expect(
      duplicateExperienceForEditor({
        duplicate,
        user,
        sourceExperienceId: "source-1",
        selectedLocale: "en",
        revalidate: vi.fn(),
      }),
    ).resolves.toMatchObject({
      ok: true,
      href: "/dashboard/experiences/copy-1?locale=fr",
    })
  })

  it("rejects an unusable empty copy without revalidating", async () => {
    const revalidate = vi.fn()

    await expect(
      duplicateExperienceForEditor({
        duplicate: vi.fn().mockResolvedValue({ id: "copy-1", locales: [] }),
        user,
        sourceExperienceId: "source-1",
        selectedLocale: "en",
        revalidate,
      }),
    ).resolves.toEqual({
      ok: false,
      error: "The duplicated Experience has no locales.",
    })
    expect(revalidate).not.toHaveBeenCalled()
  })

  it.each([
    [
      new ForbiddenError(),
      "You do not have permission to duplicate this Experience.",
    ],
    [
      new NotFoundError("Experience", "source-1"),
      "This Experience is no longer available.",
    ],
    [
      new ExperienceDuplicationError(),
      "Experience cannot be duplicated from its current saved state",
    ],
    [new Error("database secret"), "Unable to duplicate Experience."],
  ])("maps %s to a safe error", async (error, expected) => {
    await expect(
      duplicateExperienceForEditor({
        duplicate: vi.fn().mockRejectedValue(error),
        user,
        sourceExperienceId: "source-1",
        selectedLocale: "en",
        revalidate: vi.fn(),
      }),
    ).resolves.toEqual({ ok: false, error: expected })
  })
})
