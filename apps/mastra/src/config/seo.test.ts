import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getSeoCapabilities,
  getSeoConfig,
  getSeoLlmProviderConfig,
} from "./seo"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("SEO Google credential configuration", () => {
  it("bounds the GA4 properties used by one live Watch alert run", () => {
    expect(() =>
      getSeoConfig({
        SEO_GA4_PROPERTY_IDS: "one,two,three",
        WATCH_ROUTE_ALERT_MODE: "live",
      }),
    ).toThrow("at most 2 GA4 properties")
  })

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

describe("SEO model provider configuration", () => {
  it("prefers the paid OpenRouter key and normalizes the default model", () => {
    const config = getSeoConfig({
      OPENROUTER_API_PAID_KEY: "paid-key",
      OPENROUTER_API_KEY: "standard-key",
      SEO_OPENAI_API_KEY: "direct-key",
      SEO_OPENAI_MODEL: "gpt-5.4-mini",
      SEO_OPENROUTER_MODEL: "gpt-5.4-mini",
    })

    expect(config).toMatchObject({
      openRouterApiKey: "paid-key",
      openRouterModel: "openai/gpt-5.4-mini",
      openAiApiKey: "direct-key",
      openAiModel: "gpt-5.4-mini",
    })
    expect(getSeoLlmProviderConfig(config)).toEqual({
      id: "openrouter",
      apiKey: "paid-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-5.4-mini",
    })
    expect(getSeoCapabilities(config, false).groundedSearch).toBe(true)
  })

  it("retains an explicitly configured direct OpenAI fallback", () => {
    const config = getSeoConfig({
      SEO_OPENAI_API_KEY: "direct-key",
      SEO_OPENAI_MODEL: "openai/gpt-5.4-mini",
    })

    expect(config.openRouterApiKey).toBeUndefined()
    expect(config.openAiModel).toBe("gpt-5.4-mini")
    expect(getSeoLlmProviderConfig(config)).toEqual({
      id: "openai",
      apiKey: "direct-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4-mini",
    })
    expect(getSeoCapabilities(config, false).groundedSearch).toBe(true)
  })
})
