import { describe, expect, it } from "vitest"
import {
  isEditorOrAdmin,
  SYSTEM_PRINCIPAL,
  WORKFLOW_TRIGGER_PRINCIPAL,
  type Principal,
} from "./principal"

describe("isEditorOrAdmin", () => {
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
