import { expect, test } from "@playwright/test"

// Exercise Next's basePath routing, rather than calling proxy('/') directly.
// These redirects happen before content resolution and need no Admin fixture.
for (const path of [
  "/watch",
  "/watch/languages",
  "/watch/whats-new",
  "/watch/history",
]) {
  test(`negotiates the actual entry request ${path}`, async ({ request }) => {
    const suffix = path.slice("/watch".length)
    const response = await request.get(`${path}?_lr=1&ref=entry`, {
      headers: { "Accept-Language": "es" },
      maxRedirects: 0,
    })
    expect(response.status()).toBe(307)
    expect(response.headers().location).toBe(
      `/watch/spanish-castilian.html${suffix}?_lr=1&ref=entry`,
    )
    expect(response.headers()["cache-control"]).toBe("private, max-age=0")
    expect(response.headers().vary).toContain("Accept-Language")
    expect(response.headers().vary).toContain("Cookie")
  })
}

test("saved language takes precedence at the exact basePath root", async ({
  request,
}) => {
  const response = await request.get("/watch", {
    headers: {
      Cookie: "forge_watch_lang=spanish-castilian",
      "Accept-Language": "ar-EG",
    },
    maxRedirects: 0,
  })
  expect(response.status()).toBe(307)
  expect(response.headers().location).toBe("/watch/spanish-castilian.html")
})

// Assert the routing decision without requiring this suite's dummy Admin to
// render content successfully. The real-data production smoke checks 200/ISR.
test("an explicit English choice suppresses browser-language negotiation", async ({
  request,
}) => {
  const response = await request.get("/watch", {
    headers: { Cookie: "forge_watch_lang=english", "Accept-Language": "es" },
    maxRedirects: 0,
  })
  expect(response.headers().location).toBeUndefined()
})

test("explicit English content ignores conflicting language inputs", async ({
  request,
}) => {
  const response = await request.get("/watch/jesus.html/english.html", {
    headers: {
      Cookie: "forge_watch_lang=spanish-castilian",
      "Accept-Language": "ar-EG",
    },
    maxRedirects: 0,
  })
  expect(response.headers().location).toBeUndefined()
})
