import { describe, expect, it } from "vitest"

import {
  grantSubjectLabel,
  listLegacyAccessSurfaces,
  summarizeAccessControl,
  type AppAccessGrant,
} from "./access-control"

const grants = [
  {
    id: "grant_1",
    appId: "app_1",
    appKey: "admin",
    appName: "Admin",
    environmentId: "env_1",
    environmentKind: "production",
    subjectType: "user",
    userEmail: "editor@example.com",
    userName: "Editor User",
    serviceKey: null,
    status: "approved",
    reason: null,
    approvedAt: new Date("2026-05-25T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    scopes: ["admin:access"],
  },
  {
    id: "grant_2",
    appId: "app_2",
    appKey: "mastra-studio",
    appName: "Mastra Studio",
    environmentId: "env_2",
    environmentKind: "production",
    subjectType: "service",
    userEmail: null,
    userName: null,
    serviceKey: "studio-automation",
    status: "pending",
    reason: "awaiting review",
    approvedAt: null,
    revokedAt: null,
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    scopes: ["mastra-studio:access"],
  },
] satisfies AppAccessGrant[]

describe("access control view model", () => {
  it("summarizes Auth-owned grants and legacy access surfaces", () => {
    expect(summarizeAccessControl(grants, listLegacyAccessSurfaces())).toEqual({
      grantCount: 2,
      approvedGrantCount: 1,
      pendingGrantCount: 1,
      legacySurfaceCount: 3,
    })
  })

  it("labels user and service grant subjects without exposing secrets", () => {
    expect(grantSubjectLabel(grants[0])).toBe("editor@example.com")
    expect(grantSubjectLabel(grants[1])).toBe("studio-automation")
  })
})
