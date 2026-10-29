import { expect, it } from "vitest"
import { isBlockedEnrichmentNativeMutation } from "./enrichment-native-route-guard"
it("denies native mutation bypasses for the enrichment id and registration key", () => {
  for (const id of [
    "forge-video-enrichment",
    "forgeVideoEnrichmentWorkflow",
    "%66orge-video-enrichment",
  ]) {
    for (const action of [
      "create-run",
      "start",
      "start-async",
      "stream",
      "runs/run/resume",
      "runs/run/restart",
      "runs/run/cancel",
    ]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"])
        expect(
          isBlockedEnrichmentNativeMutation(
            method,
            `/api/workflows/${id}/${action}`,
          ),
        ).toBe(true)
    }
    expect(
      isBlockedEnrichmentNativeMutation("GET", `/api/workflows/${id}/runs/run`),
    ).toBe(false)
  }
  expect(
    isBlockedEnrichmentNativeMutation(
      "POST",
      "/api/workflows/subtitle-enrichment/start",
    ),
  ).toBe(false)
})
