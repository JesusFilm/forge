import { expect, it } from "vitest"
import { readEnrichmentRequestBody } from "./enrichment-request-body"
it("bounds declared and streamed enrichment bodies", async () => {
  expect(
    await readEnrichmentRequestBody(
      new Request("https://mastra.test", {
        method: "POST",
        headers: { "content-length": "65537" },
        body: "{}",
      }),
    ),
  ).toBeUndefined()
  expect(
    await readEnrichmentRequestBody(
      new Request("https://mastra.test", {
        method: "POST",
        body: JSON.stringify({ padding: "x".repeat(65537) }),
      }),
    ),
  ).toBeUndefined()
  expect(
    await readEnrichmentRequestBody(
      new Request("https://mastra.test", {
        method: "POST",
        body: '{"jobId":"job"}',
      }),
    ),
  ).toEqual({ jobId: "job" })
})
