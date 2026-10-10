# Connect ChatGPT to production Shorts

Use these instructions after the dedicated Auth client seed has deployed.
This is setup guidance, not a claim that the actual ChatGPT workflow has passed
qualification. The normal user login, consent and current Operator membership
checks still apply.

## Connection

In ChatGPT's custom MCP app setup, use:

| Setting        | Value                                     |
| -------------- | ----------------------------------------- |
| MCP URL        | `https://manager.jesusfilm.org/mcp`       |
| Authentication | OAuth with a predefined client            |
| Client ID      | `jfp_shorts_mcp_chatgpt`                  |
| Client secret  | Leave empty; this is a public PKCE client |

In **Advanced OAuth settings**, select **User-Defined OAuth Client** and token
endpoint authentication **none**. Disable **OIDC enabled**: this client does not
request identity scopes. Keep only `shorts:read`, `shorts:edit`, `shorts:render`
and `shorts:narration` as default scopes, and put `offline_access` in **Base
scopes**. Deselect `shorts:chat` and `shorts:instructions:read`. Discovery can
advertise capabilities for other clients; that does not authorize this client
to request them. If render/narration are absent from discovery, wait for the
Manager workflow deployment before completing setup.

The registered redirect is exactly
`https://chatgpt.com/connector_platform_oauth_redirect`. If the callback displayed
by your client differs, stop and have the registration reviewed; do not add a
wildcard or use the Manager browser client's ID.

Sign in through Jesus Film Auth with your own account and review the consent
screen. The dedicated client can request `shorts:read`, `shorts:edit`,
`shorts:render`, `shorts:narration` and `offline_access`. Offline access allows
renewal of consented access; it adds no tool authority. Client registration
creates no user grants or Operator memberships. A human can reach the consent
screen without a separate Auth app grant, but Manager still requires current
Operator membership before allowing tools. Synthetic agent accounts cannot use
production authorization.

The Auth startup seed provisions the exact client and resource binding. No
manual user API registration or client secret is required. If an operator
configures Manager's `STUDIO_MCP_CLIENT_IDS`, it must include this exact client.
Do not broaden anonymous dynamic registration to accept hosted callbacks.

## Portable skill and review

An MCP app connection does not install the portable skill. Obtain the shipped
[Shorts creator package](https://manager.jesusfilm.org/shorts-creator.zip).
Use a supported skill-loading mechanism for your client. If all packaged files
are supplied and verified as conversation reference material, describe that as
manual skill-context loading; attaching a ZIP alone does not prove installation.
`shorts.instructions` is hosted guidance and is not a substitute for the package.

ChatGPT's native path is **Skills → Add skill → Upload from your computer**.
Upload the ZIP and verify **Shorts creator** appears under Installed. Its editor
should list `SKILL.md`, `agents/openai.yaml`, five examples and two references.
Native upload and visible file presence were verified in the owner's account;
that does not establish invocation in a conversation or a connected MCP app.

Give the broad brief and keep feedback in the external conversation. Ask for a
rendered draft and sampled inspection, with the exact review link and disclosed
modality limits. Inspection is sampled, targets under one added minute after
rendering and permits at most one automatic defect-repair pass. Narration allows
one initial generation and one correction per authoring cycle, reusing unchanged
audio. Existing music is the default; new paid music or voice identity creation
requires explicit authorization.

Review and directly correct the result in Shorts. Human approval applies to the
exact rendered revision; agent tools cannot approve or publish. Review effective
script and voice as well as the output. Changed revisions need their own render
and review. There are no automatic conversation wakeups or editor comments.

## Qualification status

Production client registration and provider tests do not establish a completed
ChatGPT conversation. Actual login/consent, skill loading, creation, rendering,
inspection, revision and authenticated exact-result approval must still be
observed. The earlier isolated browser run encountered `ERR_BLOCKED_BY_CLIENT`;
resolve any browser block without bypassing security controls. Actual Codex
fixture evidence remains valid with its recorded synthetic-provider and modality
limits. Claude qualification is separately deferred to the owner's designer.

See [the qualification ticket](../../../docs/roadmap/media-generation/feat-548-studio-external-agent-qualify-both-clients.md)
for the remaining gates.
