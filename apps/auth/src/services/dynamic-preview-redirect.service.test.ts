import { describe, expect, it } from "vitest"

import {
  isDynamicLocalCodexMcpRedirectUriAllowed,
  isDynamicLocalWebRedirectUriAllowed,
  isDynamicRailwayPreviewRedirectUriAllowed,
} from "./dynamic-preview-redirect.service"

describe("dynamic preview redirect policy", () => {
  it("allows Railway PR callback URLs for preview/staging admin clients", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_staging",
        redirectUri:
          "https://forge-admin-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(true)
  })

  it("does not allow production clients or non-callback paths", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_production",
        redirectUri:
          "https://forge-admin-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(false)

    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_staging",
        redirectUri: "https://forge-admin-pr-123.up.railway.app/dashboard",
      }),
    ).toBe(false)
  })

  it("does not allow unrelated Railway apps to use the admin OAuth client", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_admin_staging",
        redirectUri: "https://example.up.railway.app/api/auth/callback",
      }),
    ).toBe(false)
  })

  it("allows Railway callback URLs for Mastra Studio preview clients", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_mastra_studio_preview",
        redirectUri:
          "https://forge-mastra-studio-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(true)
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_mastra_studio_preview",
        redirectUri:
          "https://forgemastra-gateway-forge-pr-992.up.railway.app/api/auth/callback",
      }),
    ).toBe(true)
  })

  it("does not allow Mastra Studio preview clients to use admin preview hosts", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_mastra_studio_preview",
        redirectUri:
          "https://forge-admin-pr-123.up.railway.app/api/auth/callback",
      }),
    ).toBe(false)
  })

  it("does not widen the chat production client beyond its exact seeded redirect", () => {
    expect(
      isDynamicRailwayPreviewRedirectUriAllowed({
        clientId: "jfp_chat_production",
        redirectUri:
          "https://forgechat-anything.up.railway.app/api/auth/callback",
      }),
    ).toBe(false)
  })

  it("allows loopback watch callbacks for the local Web client", () => {
    expect(
      isDynamicLocalWebRedirectUriAllowed({
        clientId: "jfp_web_local",
        redirectUri: "http://localhost:51810/watch/api/auth/callback",
      }),
    ).toBe(true)
    expect(
      isDynamicLocalWebRedirectUriAllowed({
        clientId: "jfp_web_local",
        redirectUri: "http://127.0.0.1:51810/watch/api/auth/callback",
      }),
    ).toBe(true)
  })

  it("rejects non-loopback or non-watch local Web callback URLs", () => {
    expect(
      isDynamicLocalWebRedirectUriAllowed({
        clientId: "jfp_web_production",
        redirectUri: "http://localhost:51810/watch/api/auth/callback",
      }),
    ).toBe(false)
    expect(
      isDynamicLocalWebRedirectUriAllowed({
        clientId: "jfp_web_local",
        redirectUri: "https://localhost:51810/watch/api/auth/callback",
      }),
    ).toBe(false)
    expect(
      isDynamicLocalWebRedirectUriAllowed({
        clientId: "jfp_web_local",
        redirectUri: "http://localhost:51810/api/auth/callback",
      }),
    ).toBe(false)
  })

  it("allows loopback Codex MCP callbacks for the dedicated client", () => {
    expect(
      isDynamicLocalCodexMcpRedirectUriAllowed({
        clientId: "jfp_admin_mcp_codex",
        redirectUri: "http://localhost:51810/auth/callback",
      }),
    ).toBe(true)
    expect(
      isDynamicLocalCodexMcpRedirectUriAllowed({
        clientId: "jfp_admin_mcp_codex",
        redirectUri: "http://127.0.0.1:51810/callback",
      }),
    ).toBe(true)
  })

  it("rejects non-loopback or non-callback Codex MCP redirect URLs", () => {
    expect(
      isDynamicLocalCodexMcpRedirectUriAllowed({
        clientId: "jfp_admin_mcp_codex",
        redirectUri: "https://localhost:51810/auth/callback",
      }),
    ).toBe(false)
    expect(
      isDynamicLocalCodexMcpRedirectUriAllowed({
        clientId: "jfp_admin_mcp_codex",
        redirectUri: "http://example.com:51810/auth/callback",
      }),
    ).toBe(false)
    expect(
      isDynamicLocalCodexMcpRedirectUriAllowed({
        clientId: "jfp_admin_mcp_codex",
        redirectUri: "http://localhost:51810/dashboard",
      }),
    ).toBe(false)
    expect(
      isDynamicLocalCodexMcpRedirectUriAllowed({
        clientId: "jfp_admin_production",
        redirectUri: "http://localhost:51810/auth/callback",
      }),
    ).toBe(false)
  })
})
