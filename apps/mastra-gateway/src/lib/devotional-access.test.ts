import { describe, expect, it } from "vitest"

import {
  canonicalizeMastraApiPath,
  isDevotionalNativeWorkflowPath,
  isSupportResearchNativeWorkflowPath,
  isWorkspaceApiPath,
} from "./devotional-access"

describe("devotional native workflow path detection", () => {
  it("matches parent, legacy, and child workflow paths", () => {
    expect(
      isDevotionalNativeWorkflowPath([
        "workflows",
        "video-first-devotional",
        "runs",
        "run-1",
      ]),
    ).toBe(true)
    expect(
      isDevotionalNativeWorkflowPath(["workflows", "devotional-approve"]),
    ).toBe(true)
    expect(
      isDevotionalNativeWorkflowPath(["workflows", "daily-devotional"]),
    ).toBe(true)
  })

  it("does not match unrelated native API paths", () => {
    expect(
      isDevotionalNativeWorkflowPath(["workflows", "offline-search-eval"]),
    ).toBe(false)
    expect(isDevotionalNativeWorkflowPath(["agents", "smoke"])).toBe(false)
  })
})

describe("support-research native workflow path detection", () => {
  it("matches launch and run paths only for support research", () => {
    expect(
      isSupportResearchNativeWorkflowPath([
        "workflows",
        "daily-support-research",
        "start-async",
      ]),
    ).toBe(true)
    expect(
      isSupportResearchNativeWorkflowPath([
        "workflows",
        "daily-support-research",
        "runs",
        "run-1",
      ]),
    ).toBe(true)
    expect(
      isSupportResearchNativeWorkflowPath([
        "workflows",
        "offline-search-eval",
        "start",
      ]),
    ).toBe(false)
  })
})

describe("Workspace API path detection", () => {
  it("matches every native Workspace operation without matching stored workspaces", () => {
    expect(isWorkspaceApiPath(["workspaces"])).toBe(true)
    expect(
      isWorkspaceApiPath(["workspaces", "devotional-workspace", "fs", "write"]),
    ).toBe(true)
    expect(
      isWorkspaceApiPath(["workspaces", "devotional-workspace", "search"]),
    ).toBe(true)
    expect(isWorkspaceApiPath(["stored-workspaces"])).toBe(false)
  })

  it("canonicalizes safe segments and rejects encoded traversal", () => {
    expect(
      canonicalizeMastraApiPath(["work%73paces", "devotional-workspace"]),
    ).toEqual(["workspaces", "devotional-workspace"])
    expect(
      canonicalizeMastraApiPath(["unrelated", "%252e%252e", "workspaces"]),
    ).toBeNull()
    expect(canonicalizeMastraApiPath(["workspaces%2Fhidden"])).toBeNull()
  })
})
