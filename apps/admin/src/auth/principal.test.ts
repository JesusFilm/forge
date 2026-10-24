import { describe, expect, it } from "vitest"
import {
  CONSUMER_BEARER_PRINCIPAL,
  isEditorOrAdmin,
  SYSTEM_PRINCIPAL,
  VIDEO_MAPPER_PRINCIPAL,
  WORKFLOW_TRIGGER_PRINCIPAL,
  type Principal,
} from "./principal"

describe("isEditorOrAdmin", () => {
  // T-01 (ce-code-review): CONSUMER_BEARER must NOT be treated as
  // editorial-tier. The predicate guards draft-visibility relation paths
  // (Experience.locales, Video.locales) — a typo widening it to include
  // CONSUMER_BEARER would silently leak templates / drafts to anonymous
  // web SSR traffic. Tests every bearer role explicitly so a regression
  // surfaces here, not at the rate-limit dashboard.
  const cases: Array<[string, Principal | null, boolean]> = [
    ["null (PUBLIC anonymous)", null, false],
    ["explicit PUBLIC principal", { id: null, role: "PUBLIC" }, false],
    ["VIEWER", { id: "viewer-1", role: "VIEWER" }, false],
    ["EDITOR", { id: "editor-1", role: "EDITOR" }, true],
    ["ADMIN", { id: "admin-1", role: "ADMIN" }, true],
    ["SYSTEM (workflow-internal)", SYSTEM_PRINCIPAL, false],
    [
      "WORKFLOW_TRIGGER (bearer-key service account)",
      WORKFLOW_TRIGGER_PRINCIPAL,
      false,
    ],
    [
      "VIDEO_MAPPER (catalog-sync service account)",
      VIDEO_MAPPER_PRINCIPAL,
      false,
    ],
    [
      "CONSUMER_BEARER (web SSR rate-limit bucket — must NEVER be editorial)",
      CONSUMER_BEARER_PRINCIPAL({ rateLimitBucketKey: "test-bucket" }),
      false,
    ],
  ]

  for (const [label, principal, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(isEditorOrAdmin(principal)).toBe(expected)
    })
  }

  it("treats an unknown role string as not privileged", () => {
    // Default-deny so a new Role union entry can't accidentally escalate.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      isEditorOrAdmin({ id: "x", role: "NEW_TIER" as any }),
    ).toBe(false)
  })
})
