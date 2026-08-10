import { afterEach, describe, expect, it, vi } from "vitest"

import { getSeoCapabilities, getSeoConfig } from "./seo"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("SEO Google credential configuration", () => {
  it("reports sealed renewable credentials as configured", () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "")
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "")
    const config = getSeoConfig({
      SEO_GSC_PROPERTY_IDS: "sc-domain:jesusfilm.org",
      SEO_GA4_PROPERTY_IDS: "320198532",
      SEO_GOOGLE_CREDENTIALS_JSON: '{"type":"service_account"}',
      SEO_GOOGLE_PROJECT_ID: "jfplab",
    })

    expect(config.googleCredentialsJson).toBe('{"type":"service_account"}')
    expect(config.googleProjectId).toBe("jfplab")
    expect(getSeoCapabilities(config, false)).toMatchObject({
      gsc: true,
      ga4: true,
    })
  })

  it("does not report an incomplete sealed credential pair as configured", () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/ambient/credentials.json")
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "ambient-project")
    const config = getSeoConfig({
      SEO_GSC_PROPERTY_IDS: "sc-domain:jesusfilm.org",
      SEO_GA4_PROPERTY_IDS: "320198532",
      SEO_GOOGLE_CREDENTIALS_JSON: '{"type":"service_account"}',
    })

    expect(getSeoCapabilities(config, false)).toMatchObject({
      gsc: false,
      ga4: false,
    })
  })

  it("lets an explicit access token override an incomplete sealed pair", () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "")
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "")
    const config = getSeoConfig({
      SEO_GSC_PROPERTY_IDS: "sc-domain:jesusfilm.org",
      SEO_GA4_PROPERTY_IDS: "320198532",
      SEO_GOOGLE_ACCESS_TOKEN: "short-lived-token",
      SEO_GOOGLE_PROJECT_ID: "jfplab",
    })

    expect(getSeoCapabilities(config, false)).toMatchObject({
      gsc: true,
      ga4: true,
    })
  })
})
