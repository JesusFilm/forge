import { expect, it, vi } from "vitest"
vi.mock("@/config/env", () => ({ env: {} }))
import { canonicalMediaUrl } from "./studio-broker"

it.each([
  "https://mux.com/a",
  "https://stream.mux.com/a",
  "https://manifest-oci-us-ashburn-1-vop1.fastly.mux.com/a",
  "https://chunk-new-region.fastly.mux.com/a",
  "https://api-media-core.jesusfilm.org/a",
])("accepts canonical Mux and Core media URL %s", (url) => {
  expect(canonicalMediaUrl(url).href).toBe(url)
})

it.each([
  "http://manifest-oci-us-ashburn-1-vop1.fastly.mux.com/a",
  "https://manifest-oci-us-ashburn-1-vop1.fastly.mux.com:8443/a",
  "https://user@manifest-oci-us-ashburn-1-vop1.fastly.mux.com/a",
  "https://manifest-oci-us-ashburn-1-vop1.fastly.mux.com.evil.test/a",
  "https://notmux.com/a",
  "https://mux.com.evil.example/a",
  "https://mux.com@evil.example/a",
  "https://127.0.0.1/a",
])("rejects unapproved source URL %s", (url) => {
  expect(() => canonicalMediaUrl(url)).toThrow(
    "Unapproved canonical media host",
  )
})
