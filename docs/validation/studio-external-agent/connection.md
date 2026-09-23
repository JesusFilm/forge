# Connect an existing conversation to Shorts

Use the Manager environment's `/mcp` URL (for example,
`https://<manager-host>/mcp`), not Admin's independent MCP resource. The
resource publishes OAuth metadata at `/.well-known/oauth-protected-resource`.
The operator must have current Operator membership. Reviewer membership does not
permit authoring. All active operators share the existing Studio project catalog;
there is no project-owner-only access model in this release.

## Environment prerequisites

The normal release must configure matching Auth issuer, registered `shorts-mcp`
application/environment, resource audience, Manager's `STUDIO_ENVIRONMENT`, and
Admin's delegated-signature trust. The optional `STUDIO_MCP_CLIENT_IDS` allowlist
must include the client's registered OAuth identity. Authorize only the required
consent scopes; `shorts:read` discovers/reads, `shorts:edit` creates/edits. Hosted
chat and instruction read have independent scopes. Additional paid execution
requires its own consent and admission; edit consent is not payment consent.
Never paste Manager/Admin service secrets or bearer tokens into the conversation.

## Claude

In a Claude client/account supporting remote custom MCP connectors, add the
Manager `/mcp` URL as a custom connector and complete its browser OAuth sign-in
and consent. Enable the connector in the existing conversation. If custom
connectors are unavailable or the URL cannot be reached, record that client or
network restriction; it does not establish a server failure. Local-only endpoints
are not automatically reachable from a hosted Claude session.

## Codex

Register the same URL as a remote HTTP MCP server using the installed Codex
client's MCP settings (or `codex mcp add shorts --url <manager-url>/mcp` where
supported), then use `codex mcp login shorts` for OAuth. Return to the existing
conversation and enable/reload the connection as required by that client.
Record the actual client version and commands used during qualification; these
instructions are not evidence of a completed connection.

## Editing proof and safe resumption

Ask the agent to list `shorts.projects` with a small limit, following `nextCursor`
until the intended project is found, or resolve your existing editor URL with
`shorts.resolveProject`. Resolution accepts only this environment's exact project
path and always reads current state. It never follows arbitrary URLs. Confirm the
title and identity before editing. A `reviewUrl` includes the observed revision
as evidence; the editor currently opens its live state, not an immutable snapshot.

Use `shorts.read`, then `shorts.apply` with the observed `expectedRevision` and a
stable unique idempotency key. Retry the identical accepted command with the same
key after a lost response. A different client or changed payload cannot reuse that
receipt. On `CONFLICT`, read current state and `shorts.history`, preserve human
changes, and use a new key to apply only reconciled changes. History accepts
`beforeRevision` to page older revisions. Ask about creative conflicts instead of
silently replacing human edits. Open the returned editor link and verify history
attributes the revision to the signed-in operator and connected client.

No tool may approve, publish, or perform destructive operations for the human.
Feedback stays in the external conversation. Revocation or expired credentials
require a fresh authorized connection; never substitute an actor in tool input.

## Qualification status

Not yet qualified in real Claude or Codex clients. Transport tests and real
Postgres authoring tests are separate evidence and do not satisfy this acceptance.
A deployed or reachable configured test Manager/Auth/Admin environment, an active
Operator account, and authenticated clients supporting remote OAuth MCP are
required for the real editing proof. Record client versions, environment, consent,
project/revision identities, UI history observation and any unsupported capability.
Do not use paid providers to complete this connection-only proof.
