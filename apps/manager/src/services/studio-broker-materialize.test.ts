import { afterEach, expect, it, vi } from "vitest"
vi.mock("@/config/env", () => ({
  env: {
    ADMIN_MANAGER_API_KEY: "fixture-only",
    ADMIN_GRAPHQL_URL: "https://admin.example/api/graphql",
  },
}))
import { materialize } from "./studio-broker"
const ref = { assetId: "asset", versionId: "version", digest: "a".repeat(64) }
const snapshot = {
  id: "snapshot",
  source: {
    videoId: "video",
    dubId: "dub",
    editionId: "edition",
    language: "english",
    subtitle: {
      trackId: "track",
      editionId: "edition",
      language: "english",
      asset: ref,
    },
    preview: ref,
    export: ref,
    startMs: 0,
    endMs: 1000,
  },
  durationMs: 1000,
  downloadId: "download",
  hlsUrl: "https://stream.mux.com/a",
  downloadUrl: "https://stream.mux.com/a",
  subtitleUrl: "https://stream.mux.com/a",
  catalogDigest: "b".repeat(64),
  restrictions: [],
  materialization: "descriptor" as const,
  originalByteDigest: null,
  coveredRanges: [],
  exportHeight: 1080,
  subtitlePrimary: true,
  subtitleAiGenerated: false,
}
afterEach(() => vi.unstubAllGlobals())
it("materializes through the current Admin schema and reads its canonical response", async () => {
  const canonical = {
    ...snapshot,
    id: "materialized",
    materialization: "broker-manifest",
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body)
      expect(body.query).toContain("materializeShortsSource(input:")
      expect(body.variables.input.sourceSnapshotId).toBe(snapshot.id)
      return Response.json({ data: { materializeShortsSource: canonical } })
    }),
  )
  await expect(materialize(snapshot, ref, ref)).resolves.toEqual(canonical)
})
