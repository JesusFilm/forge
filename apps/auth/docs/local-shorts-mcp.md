# Local Shorts MCP tunnel qualification

For isolated local Shorts MCP qualification through an HTTPS tunnel, set
`AUTH_SHORTS_LOCAL_PUBLIC_ORIGIN` to the exact public Manager origin before
seeding first-party apps and starting Auth. It replaces only the local Shorts
MCP resource and its seeded callback, keeping the resource catalog, DCR scopes,
and token claims aligned. It rejects paths, credentials, queries, fragments,
hosted Shorts origins, and production runtimes. It does not change Manager's
browser client registration or approve a dynamically registered client's access.
Never set it on hosted Auth deployments.
