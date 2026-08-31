import { describe, expect, it } from "vitest"
import {
  buildCompiledData,
  renderHtml,
} from "../scripts/lib/dashboard/compile.js"
import type { ProdStatusData } from "../scripts/lib/dashboard/types.js"
import { assertPublicDashboardSafe } from "../scripts/lib/dashboard/public-safety.js"

const prod: ProdStatusData = {
  schema_version: 1,
  target: "production-read",
  fetched_at: "2026-08-31T00:00:00.000Z",
  source_commit: "0123456789abcdef0123456789abcdef01234567",
  schema_digest:
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ingested: [],
  acquired_keys: [],
  unclassified: [],
}

describe("public dashboard hardening", () => {
  it.each([
    ["dsn", { lifecycle: { missing: "postgresql://user:pass@db/rag" } }],
    ["token", { sourceMap: { note: "token=super-secret" } }],
    ["path", { registry: { name: "/Users/operator/private.txt" } }],
    ["internal host", { output: { host: "rag.railway.internal" } }],
    ["corpus", { output: { note: "x".repeat(5_001) } }],
    ["bidi", { output: { name: "safe\u202eevil" } }],
    ["script terminator", { output: { name: "</script>" } }],
  ])("rejects %s in any public projection branch", (_label, value) => {
    expect(() => assertPublicDashboardSafe(value)).toThrow()
  })

  it("contextually encodes executable and directional markup", () => {
    const data = buildCompiledData({
      prod,
      registry: [
        {
          key: "safe",
          name: "<script>alert(1)</script>\u202e",
          domain: "safe.example",
          languages: ["en"],
        },
      ],
      yaml: {},
    })
    const html = renderHtml(
      "<p><!-- DASHBOARD_GENERATED_AT --></p><!-- DASHBOARD_SUMMARY --><table><tbody><!-- DASHBOARD_ROWS --></tbody></table><!-- DASHBOARD_UNCLASSIFIED -->",
      data,
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("rejects production inventory outside the canonical registry", () => {
    expect(() =>
      buildCompiledData({
        prod: { ...prod, acquired_keys: ["unknown"] },
        registry: [],
        yaml: {},
      }),
    ).toThrow(/unknown canonical source/)
  })
})
