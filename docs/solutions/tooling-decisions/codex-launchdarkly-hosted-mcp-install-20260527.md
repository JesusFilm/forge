---
title: "Use LaunchDarkly hosted MCP for Codex flag administration"
date: 2026-05-27
category: docs/solutions/tooling-decisions
module: "Codex MCP tooling"
problem_type: tooling_decision
component: tooling
severity: low
applies_when:
  - "Configuring Codex or another AI agent to create and manage LaunchDarkly flags"
  - "Choosing between LaunchDarkly hosted OAuth MCP and local API-token MCP"
  - "Verifying an MCP server install before relying on agent-side flag operations"
related_components:
  - launchdarkly
  - forge-feature-flags
tags:
  - launchdarkly
  - mcp
  - codex
  - oauth
  - feature-flags
  - tooling
---

# Use LaunchDarkly Hosted MCP for Codex Flag Administration

## Context

After Forge gained the `@forge/feature-flags` LaunchDarkly runtime foundation,
the next operator need was agent-side flag management: creating flags,
inspecting flag state, and manipulating targeting without hand-driving the
LaunchDarkly UI. LaunchDarkly exposes API, CLI, and MCP surfaces; for Codex, the
best fit is the hosted LaunchDarkly MCP server because it uses OAuth and avoids
storing a LaunchDarkly API token directly in MCP config.

Session history search found no earlier Forge-specific LaunchDarkly MCP install
attempts. It did surface separate LaunchDarkly product work for web download
gating, which is related to flag usage but not to agent-side MCP setup.
(session history)

## Guidance

Use the hosted LaunchDarkly MCP endpoint for Codex:

```bash
codex mcp add launchdarkly --url https://mcp.launchdarkly.com/mcp/launchdarkly
```

Codex detects OAuth support for that streamable HTTP server and starts an
authorization flow. Open the printed LaunchDarkly URL, approve the connection,
and wait for the local callback to finish. A successful setup prints:

```text
Successfully logged in.
```

Verify the install from Codex, not from LaunchDarkly's UI alone:

```bash
codex mcp list
codex mcp get launchdarkly
rg -n "\[mcp_servers\.launchdarkly\]|mcp\.launchdarkly" ~/.codex/config.toml
```

Expected Codex config:

```toml
[mcp_servers.launchdarkly]
url = "https://mcp.launchdarkly.com/mcp/launchdarkly"
```

Expected `codex mcp get launchdarkly` shape:

```text
launchdarkly
  enabled: true
  transport: streamable_http
  url: https://mcp.launchdarkly.com/mcp/launchdarkly
```

Treat this MCP as operator tooling. It does not replace app runtime
configuration:

- `LAUNCHDARKLY_SDK_KEY` is still the server-side SDK key used by Forge apps to
  evaluate flags.
- The MCP OAuth grant is for the AI agent to manage LaunchDarkly resources.
- Neither the SDK key nor an API access token belongs in browser-exposed
  `NEXT_PUBLIC_*` variables.

## Why This Matters

Hosted MCP keeps the secret boundary cleaner. The older local MCP mode requires
an API access token and can tempt agents or config files into exposing a token
in conversation or source-adjacent files. OAuth also matches the way other
hosted MCPs are already used in Forge workflows, such as Railway.

For Forge feature-flag work, this gives agents the right operational lane:

- Code defines typed flag keys and safe fallbacks.
- Railway/local env config controls runtime evaluation.
- LaunchDarkly MCP manages the remote flag resources and targeting rules.

Keeping those responsibilities separate makes it much harder to confuse app
runtime secrets with agent administration credentials.

## When to Apply

Apply this when:

- A Forge task needs LaunchDarkly flags created, toggled, inspected, copied
  between environments, or targeted.
- An agent asks whether to use LaunchDarkly API, CLI, local MCP, or hosted MCP.
- A new Codex environment needs the LaunchDarkly MCP made available.

Skip or revisit this when:

- The LaunchDarkly account is on an instance that requires a different MCP host
  URL.
- The work requires strict read-only access; hosted OAuth scopes may need
  account-side review before the agent runs write tools.
- The AI client cannot use hosted streamable HTTP MCP with OAuth. In that case,
  the local `@launchdarkly/mcp-server` setup is a fallback, but use an
  environment variable for the token rather than embedding the API key in the
  MCP config.

## Examples

### Codex install

```bash
codex mcp add launchdarkly --url https://mcp.launchdarkly.com/mcp/launchdarkly
```

Codex then prints a LaunchDarkly OAuth authorization URL. After browser approval
and callback completion, it stores the global MCP entry in
`~/.codex/config.toml`.

### Confirm it is present

```bash
codex mcp list
codex mcp get launchdarkly
```

The server should be listed as enabled with the URL
`https://mcp.launchdarkly.com/mcp/launchdarkly`. If the active Codex tool list
does not show LaunchDarkly tools immediately, restart or reload Codex so the
new MCP server is loaded into the session.

### Use it after feature-flag code lands

Once code references a new flag key, ask the agent to use LaunchDarkly MCP to:

- create the flag in the expected project
- keep the flag off by default in all environments
- add tags/description that match the Forge roadmap or PR
- configure per-environment targeting only after runtime fallbacks are verified

## Related

- `docs/solutions/platform/launchdarkly-feature-flag-foundation-20260527.md` -
  Forge runtime flag-evaluation pattern and Railway/local env setup.
- `docs/roadmap/platform/feat-144-launchdarkly-feature-flag-foundation.md` -
  original Forge LaunchDarkly foundation scope.
- LaunchDarkly hosted MCP docs:
  `https://launchdarkly.com/docs/home/getting-started/mcp-hosted`
- LaunchDarkly MCP overview:
  `https://launchdarkly.com/docs/home/getting-started/mcp`
- LaunchDarkly local MCP fallback docs:
  `https://launchdarkly.com/docs/home/getting-started/mcp-local`
