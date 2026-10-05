// @vitest-environment node
import { expect, it } from "vitest"
import { pinnedUrl, providerConfig } from "./config"
it.each([
  "http://gateway.test",
  "https://user:pass@gateway.test",
  "https://evil.test",
  "https://gateway.test.evil.test",
  "https://gateway.test?secret=x",
])("rejects unsafe destinations: %s", (value) => {
  expect(() => pinnedUrl(value, "gateway.test")).toThrow("unavailable")
})
it("keeps missing and malformed optional config inert without a model default", () => {
  expect(providerConfig({})).toBeNull()
  expect(
    providerConfig({
      APOLOGIST_API_URL: "not a url",
      APOLOGIST_API_KEY: "fixture",
      APOLOGIST_MODEL_ID: "fixture",
      APOLOGIST_ALLOWED_HOSTS: "gateway.test",
    }),
  ).toBeNull()
  expect(
    providerConfig({
      APOLOGIST_API_URL: "https://gateway.test",
      APOLOGIST_API_KEY: "fixture",
      APOLOGIST_ALLOWED_HOSTS: "gateway.test",
    }),
  ).toBeNull()
})
