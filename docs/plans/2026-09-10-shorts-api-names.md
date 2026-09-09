# Shorts API naming

User direction: use Shorts for the replacement and rename unshipped API identifiers rather than retaining compatibility aliases. Fixed base: e91bd41115637accf7b6797fdac044bc4d1de57f.

- Rename new feature HTTP routes and all exact path validators/callers from `/api/studio` to `/api/shorts`; rename its Admin triggers and native `/forge-studio` endpoints consistently.
- Rename public GraphQL types, fields and operation names to Shorts, regenerate SDL and gql.tada output, and update response decoding.
- Rename feature MCP tool names, OAuth scopes, service audiences/headers/token types and machine caller identities together. Old names must not remain accepted aliases.
- Preserve unrelated pre-existing Mastra developer Studio and Manager application branding. Internal source module names and database models are not API aliases. No deployed configuration, provider, registry or VM changes are implied by this source rename.
- Keep the pending Watch revert separate. It must not enter this commit or be silently reversed for typechecking.

Validation: focused route/transport/schema/auth tests, generated contracts and affected types; check old namespace rejection and retained authority checks. Record only concise outcomes here; do not add raw validation captures to the PR. Existing local images/configuration and historical fixtures do not prove the renamed API is deployed.

Completed: public HTTP/GraphQL/MCP/auth identifiers and callers now use Shorts without old aliases. Normal SDL and gql.tada generation completed. Focused route, client-operation, contract, transport, auth and old-namespace rejection checks passed; affected Admin, Manager, Auth and Mastra typechecks and changed-source lint passed. Admin required regeneration of a stale local Prisma client; Mastra required restoration of its existing workspace dependency link. Independent Spec review and Standards review of the independently authored changes are clear. No raw captures added, deployment performed or pending Watch edits included.
