import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { OAuthConsentPageClient } from "./consent-page-client"

describe("OAuth consent UI", () => {
  it("renders a styled authorization choice with requested scopes", () => {
    const html = renderToStaticMarkup(
      <OAuthConsentPageClient
        oauthQuery="client_id=codex&scope=experience%3Aread&sig=signed"
        requestingAppName="Jesus Film Admin MCP"
        scopes={[
          {
            key: "experience:read",
            label: "Read experiences",
            description:
              "Read Experience pages and locale content for localization.",
          },
        ]}
      />,
    )

    expect(html).toContain("Authorize access.")
    expect(html).toContain("Jesus Film Admin MCP")
    expect(html).toContain("Read experiences")
    expect(html).toContain("Authorize application")
    expect(html).toContain("Deny access")
    expect(html).toContain('aria-label="Legal"')
  })

  it("renders persistent access as an explicit permission", () => {
    const html = renderToStaticMarkup(
      <OAuthConsentPageClient
        oauthQuery="client_id=codex&scope=offline_access&sig=signed"
        requestingAppName="Jesus Film Admin MCP"
        scopes={[
          {
            key: "offline_access",
            label: "Stay signed in",
            description:
              "Allow the requesting application to keep access active without asking you to sign in again.",
          },
        ]}
      />,
    )

    expect(html).toContain("Stay signed in")
    expect(html).toContain("keep access active")
  })

  it("shows the exact Changelog target and marks dynamic client metadata unverified", () => {
    const html = renderToStaticMarkup(
      <OAuthConsentPageClient
        oauthQuery="client_id=dynamic-client&amp;scope=changelog%3Aread&amp;resource=http%3A%2F%2Flocalhost%3A3000%2Fmcp"
        requestingAppName="Claude Desktop"
        scopes={[]}
        target={{
          environment: "Local",
          resource: "http://localhost:3000/mcp",
        }}
        unverifiedDynamicClient
      />,
    )

    expect(html).toContain("Local Changelog")
    expect(html).toContain("http://localhost:3000/mcp")
    expect(html).toContain("Unverified client name")
  })
})
