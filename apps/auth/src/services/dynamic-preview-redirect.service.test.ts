import { describe, expect, it } from "vitest"

import { TV_DEVICE_CLIENT_IDS } from "@/domain/apps"

import {
  DYNAMIC_PREVIEW_CLIENT_IDS,
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

  it("never lists a TV device client in DYNAMIC_PREVIEW_CLIENT_IDS", () => {
    for (const clientId of TV_DEVICE_CLIENT_IDS) {
      expect(DYNAMIC_PREVIEW_CLIENT_IDS.has(clientId)).toBe(false)
    }
    // Anti-vacuous: the set is real and non-empty, so the loop above is a
    // statement about the TV client ids, not about an empty container.
    expect(DYNAMIC_PREVIEW_CLIENT_IDS.has("jfp_admin_staging")).toBe(true)
  })

  it("keeps every TV device client out of the dynamic redirect sets", () => {
    // The TV clients carry ONE sentinel redirect URI that is bound into the
    // authorization code and never navigated. Admitting them to any dynamic
    // set would let a caller persist an attacker-chosen redirect URI onto a
    // client that redeems device codes.
    for (const clientId of TV_DEVICE_CLIENT_IDS) {
      // Falsification is uneven and the membership pin above is what actually
      // holds the line. The local-web and Codex assertions DO go red if a TV id
      // is added to their sets. The Railway one does NOT: admitting a TV id to
      // DYNAMIC_PREVIEW_CLIENT_IDS still returns false because
      // `isAllowedPreviewHostname` only knows the jfp_admin_/jfp_mastra_studio_
      // prefixes. Verified by mutation. Keep it as defence in depth for the day
      // a jfp_tv_ prefix branch is added there.
      expect(
        isDynamicRailwayPreviewRedirectUriAllowed({
          clientId,
          redirectUri:
            "https://forge-admin-pr-123.up.railway.app/api/auth/callback",
        }),
      ).toBe(false)
      expect(
        isDynamicLocalWebRedirectUriAllowed({
          clientId,
          redirectUri: "http://localhost:51810/watch/api/auth/callback",
        }),
      ).toBe(false)
      expect(
        isDynamicLocalCodexMcpRedirectUriAllowed({
          clientId,
          redirectUri: "http://localhost:51810/auth/callback",
        }),
      ).toBe(false)
    }
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
