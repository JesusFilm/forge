---
module: Auth
problem_type: integration_issue
tags: [oauth, shorts, mcp, qualification, cloudflare]
---

# Registered MCP resources must reach authorization policy

Adding Shorts to `apps/auth/src/domain/oauth-resources.ts` made discovery and
resource-derived claims look correct, but the separate authorize classifier in
`apps/auth/src/app/api/auth/[...all]/route.ts` recognized only Admin MCP and
Changelog MCP. A real Shorts authorize request therefore failed with
`invalid_target` before reaching the existing provider policy. Locally pre-issued
fixture tokens could not detect this failure.

Route regression tests now cover every registered Shorts environment and verify
that redirect, requested scopes, state and PKCE reach the provider unchanged.
Unknown paths and multiple resources still fail closed. Discovery, token
verification and a scripted MCP exchange do not prove interactive OAuth works.

A local HTTPS tunnel also needs an exact registered resource audience; adding it
as a generic custom audience does not assign Shorts app/environment claims.
`AUTH_SHORTS_LOCAL_PUBLIC_ORIGIN` updates only the local Shorts seed consumed by
all resource catalogs. Set it before seeding and starting nonproduction Auth.
It rejects production runtimes and hosted Shorts-origin collisions. Never use a
proxy to convert a generic or incorrectly scoped bearer into Shorts authority.

The existing public DCR policy admits native loopback callbacks. A hosted
ChatGPT callback needs an explicitly registered client with its observed exact
callback and PKCE; this qualification preserved the DCR restriction. Auth-owned
agent login handles also require an approved nonproduction app environment and
grant. The resulting identity separately needs current Operator membership in
Admin. None of these registrations gives MCP human approval or publication
capabilities.

Temporary UI access used a private, expiring gateway around the isolated fixture
app. Gateway Origin validation happened before translation to the app's configured
loopback origin. Exact render bytes were retrieved and digest-checked, but a Chrome
navigation block prevented browser approval evidence. Keep transport, browser,
real-client and hosted release qualification distinct.
