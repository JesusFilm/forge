import { describe, expect, it } from "vitest"

import { formatEnum, summarizeRegistry, type RegistryApp } from "./app-registry"
import { editableScopesForEnvironment } from "./access-grants"

const apps = [
  {
    id: "app_1",
    key: "admin",
    displayName: "Admin",
    description: null,
    trustTier: "first_party",
    ownerType: "jesus_film",
    ownerName: "Jesus Film Project",
    status: "active",
    environments: [
      {
        id: "env_1",
        key: "local",
        kind: "local",
        clientId: "jfp_admin_local",
        redirectUris: ["http://localhost:3003/api/auth/callback"],
        allowedOrigins: ["http://localhost:3003"],
        defaultScopes: ["openid", "admin:access"],
        status: "approved",
        autoApprove: true,
      },
      {
        id: "env_2",
        key: "production",
        kind: "production",
        clientId: "jfp_admin_production",
        redirectUris: ["https://admin.jesusfilm.org/api/auth/callback"],
        allowedOrigins: ["https://admin.jesusfilm.org"],
        defaultScopes: ["openid", "admin:access"],
        status: "pending",
        autoApprove: false,
      },
    ],
  },
] satisfies RegistryApp[]

describe("app registry view model", () => {
  it("summarizes registry review posture", () => {
    expect(summarizeRegistry(apps)).toEqual({
      appCount: 1,
      environmentCount: 2,
      productionCount: 1,
      pendingReviewCount: 1,
    })
  })

  it("formats enum values for operator-facing labels", () => {
    expect(formatEnum("first_party")).toBe("first party")
    expect(formatEnum("production")).toBe("production")
  })

  it("limits editable grant scopes to app access and Developer admin scopes", () => {
    expect(
      editableScopesForEnvironment({
        appId: "app_developer",
        appKey: "developer",
        appName: "Developer",
        environmentId: "env_developer",
        environmentKey: "local",
        kind: "local",
        clientId: "jfp_developer_local",
        defaultScopes: [
          "openid",
          "email:read",
          "developer:access",
          "tokens:manage",
        ],
      }),
    ).toEqual(["developer:access", "developer:admin"])
  })
})
