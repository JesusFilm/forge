import { expect, it, vi } from "vitest"
import {
  enrichmentProviderFetch,
  EnrichmentSpendAmbiguousError,
  EnrichmentSettledError,
  trackEnrichmentSpend,
} from "./provider-spend"

it("detects swallowed network errors and prevents another request in that stage", async () => {
  const network = vi.fn<typeof fetch>(async () => {
    throw new Error("timeout")
  })
  await expect(
    trackEnrichmentSpend(async () => {
      await enrichmentProviderFetch(network, "https://fixture.invalid").catch(
        () => {},
      )
      await enrichmentProviderFetch(network, "https://fixture.invalid").catch(
        () => {},
      )
      return "leaf claimed success"
    }),
  ).rejects.toBeInstanceOf(EnrichmentSpendAmbiguousError)
  expect(network).toHaveBeenCalledTimes(1)
})
it("an ambiguous request overrides a later settled validation error", async () => {
  await expect(
    trackEnrichmentSpend(async () => {
      await enrichmentProviderFetch(async () => {
        throw new Error("lost response")
      }, "https://fixture.invalid").catch(() => {})
      throw new EnrichmentSettledError("invalid local output")
    }),
  ).rejects.toBeInstanceOf(EnrichmentSpendAmbiguousError)
})
it("isolates concurrent stage outcomes and does not mark a returned HTTP refusal ambiguous", async () => {
  const results = await Promise.allSettled([
    trackEnrichmentSpend(async () =>
      enrichmentProviderFetch(async () => {
        throw new Error("timeout")
      }, "https://fixture.invalid"),
    ),
    trackEnrichmentSpend(
      async () =>
        (
          await enrichmentProviderFetch(
            async () => new Response(null, { status: 403 }),
            "https://fixture.invalid",
          )
        ).status,
    ),
  ])
  expect(results[0].status).toBe("rejected")
  expect(results[1]).toEqual({ status: "fulfilled", value: 403 })
})
