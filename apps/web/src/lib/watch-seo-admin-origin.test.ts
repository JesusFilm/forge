import { describe, expect, it } from "vitest"
import { watchSeoAdminOrigin } from "./watch-seo-admin-origin"

describe("watchSeoAdminOrigin", () => {
  it("derives navigation only from the configured public Admin endpoint", () => {
    expect(
      watchSeoAdminOrigin("https://admin.jesusfilm.org/api/graphql", true),
    ).toBe("https://admin.jesusfilm.org")
  })

  it.each([
    "http://admin.jesusfilm.org/api/graphql",
    "https://forgeadmin.railway.internal/api/graphql",
    "https://forgeadmin.railway.internal./api/graphql",
    "https://admin.local/api/graphql",
    "https://localhost/api/graphql",
    "https://127.0.0.1/api/graphql",
    "https://10.0.0.1/api/graphql",
    "https://[::1]/api/graphql",
    "https://auth.jesusfilm.org/api/graphql",
    "https://user:password@admin.jesusfilm.org/api/graphql",
    "https://admin.jesusfilm.org/api/graphql?token=secret",
    "javascript:alert(1)",
    "invalid",
  ])(
    "fails closed for invalid or non-public production navigation: %s",
    (url) => {
      expect(watchSeoAdminOrigin(url, true)).toBeNull()
    },
  )

  it("allows local/CI HTTP only outside production", () => {
    expect(
      watchSeoAdminOrigin("http://localhost:3003/api/graphql", false),
    ).toBe("http://localhost:3003")
    expect(
      watchSeoAdminOrigin("http://localhost:3003/api/graphql", true),
    ).toBeNull()
  })
})
