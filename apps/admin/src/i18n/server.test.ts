import { beforeEach, describe, expect, it, vi } from "vitest"

let cookieLocale: string | undefined
let acceptLanguageHeader: string | null

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === "forge-admin-locale" && cookieLocale
        ? { value: cookieLocale }
        : undefined,
  })),
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name.toLowerCase() === "accept-language" ? acceptLanguageHeader : null,
  })),
}))

describe("admin i18n server locale resolution", () => {
  beforeEach(() => {
    cookieLocale = undefined
    acceptLanguageHeader = null
  })

  it("prefers locale cookie when present", async () => {
    cookieLocale = "es"
    acceptLanguageHeader = "en-US,en;q=0.9"

    const { getAdminLocale } = await import("./server")
    await expect(getAdminLocale()).resolves.toBe("es")
  })

  it("falls back to accept-language when cookie is absent", async () => {
    acceptLanguageHeader = "es-ES,es;q=0.9,en;q=0.8"

    const { getAdminLocale } = await import("./server")
    await expect(getAdminLocale()).resolves.toBe("es")
  })

  it("defaults to english for unsupported locales", async () => {
    acceptLanguageHeader = "fr-FR,fr;q=0.9,de;q=0.8"

    const { getAdminLocale } = await import("./server")
    await expect(getAdminLocale()).resolves.toBe("en")
  })
})
