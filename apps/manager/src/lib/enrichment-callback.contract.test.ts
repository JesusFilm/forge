import { describe, expect, it } from "vitest"

import callbackFixtures from "../../../../docs/fixtures/manager-enrichment-callbacks.json"
import { EnrichmentCallbackSchema } from "@/lib/enrichment-callback"

describe("EnrichmentCallbackSchema shared fixtures", () => {
  it.each(Object.entries(callbackFixtures))("accepts %s", (_name, callback) => {
    expect(EnrichmentCallbackSchema.safeParse(callback).success).toBe(true)
  })
})
