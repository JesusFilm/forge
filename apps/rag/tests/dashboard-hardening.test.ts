import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import path from "node:path"
import {
  buildCompiledData,
  renderHtml,
} from "../scripts/lib/dashboard/compile.js"
import type { ProdStatusData } from "../scripts/lib/dashboard/types.js"
import { assertPublicDashboardSafe } from "../scripts/lib/dashboard/public-safety.js"
import { parseCanonicalLifecycle } from "../scripts/dashboard-compile.js"

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
    ["GitHub token", { output: { value: "ghp_1234567890abcdefghij" } }],
    [
      "GitHub fine-grained token",
      { output: { value: "github_pat_1234567890_abcdefghij" } },
    ],
    ["OpenAI key", { output: { value: "sk-1234567890abcdefghij" } }],
    ["AWS access key", { output: { value: "AKIA1234567890ABCDEF" } }],
    [
      "PEM private key",
      { output: { value: "-----BEGIN RSA PRIVATE KEY-----" } },
    ],
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

  it("validates lifecycle shape and registry identity before compilation", () => {
    const validRow = `
    name: Safe
    status: done
    last_updated: 2026-08-31
    slice_file: docs/safe.md
    languages:
      en:
        status: done
        stages:
          acquire: green
          ingest: green
          retrieve: green
          evaluate: green`
    expect(() =>
      parseCanonicalLifecycle(`sources:\n  safe:${validRow}\n`, [
        { key: "other", languages: ["en"] },
      ]),
    ).toThrow(/registry keys/)
    expect(() =>
      parseCanonicalLifecycle("sources:\n  safe:\n    name: Safe\n", [
        { key: "safe", languages: ["en"] },
      ]),
    ).toThrow()
  })

  it("keeps dashboard transaction residue out of Git", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..")
    const residue = [
      "apps/rag/dashboard/prod-status-data.json.tmp-123",
      "apps/rag/dashboard/.compiled-data.json.uuid.tmp",
      "apps/rag/dashboard/compiled-data.json.uuid.bak",
      "apps/rag/dashboard/site/rag-status/.index.html.uuid.tmp",
      "apps/rag/dashboard/site/rag-status/index.html.uuid.bak",
      "apps/rag/dashboard/site/rag-status/..dashboard-commit.json.uuid.tmp",
      "apps/rag/dashboard/site/rag-status/.dashboard-commit.json.uuid.bak",
      "apps/rag/dashboard/site/rag-status/.dashboard-commit.json.lock/owner",
    ]
    const ignored = execFileSync(
      "git",
      ["check-ignore", "--no-index", ...residue],
      { cwd: repoRoot, encoding: "utf8" },
    )
      .trim()
      .split("\n")
    expect(ignored).toEqual(residue)
  })
})
