---
module: Studio
problem_type: integration_issue
tags: [studio, mastra, native-editor, oauth, instructions, admission]
---

# Native Studio instructions and delegated authoring

Feat-457 builds on reviewed `e12643ecc76c30f73722848195a62d66865f7a90`.
The native probe and operator evidence are in `docs/validation/studio-457/`.

## Boundaries

Manager's `/api/shorts/agent` uses its authenticated same-origin cookie session.
Only this interactive route may save/test/activate/restore instruction versions.
The hosted authoring adapter deliberately changes authority to delegated before
requesting attempts or applying proposals. Undo is an explicit interactive
revision-checked restore-document command. Owner attribution is retained.

External `/mcp` verifies Auth issuer, Studio resource audience, resource-derived
app/environment claims, expiry, client identity, current Operator membership,
and each tool's Studio scope. It never promotes a human-owned bearer to
interactive review authority. `shorts:read`, `shorts:edit`, `shorts:chat` and
`shorts:instructions:read` are separately consented capabilities. No MCP approval,
activation, publication, experiment or narration-execution tool is registered.
Existing non-Studio OAuth resources retain their policies.

Node-only `@forge/studio-server` signs/verifies bounded exact-body Ed25519
assertions. This is separate from the pure `@forge/studio-contracts` schemas.
The audience and token type differ from feat-456 interactive assertions. Manager
holds the signing key server-side; neither models nor MCP clients receive it.
Admin exposes narrow delegated commands and revision-bound source/asset tools.
Transferred component bytes retain the verified owner's authority and client ID
in the server-issued capability and durable asset actor. Payload actor overrides
are rejected, and expiry/kind/size/hash checks remain enforced.

## Native instruction lifecycle

Installed native APIs are authoritative; there is no second prompt body store.
The scoped runtime alone receives a native `PostgresStore` using schema
`mastra_studio_authoring` on the existing database. Generic Editor/composite
storage retains schema `mastra`. It never receives the authoritative Studio
store. Identically named generic agents/blocks are unrelated shadow resources:
the scoped runtime neither reads nor falls back to them. No prompt rows were
previously deployed/shared, so no body copy or production migration is needed.
Native tables initialize after authenticated access; the execution metadata SQL
migration remains explicit.

An actual built-server probe exposed draft bodies through generic native lists
when both used the same store. The final fix isolates native authority instead
of filtering route shapes. Generic collections, clone, derived-name creation,
version activation/restore and deletion retain their unrelated Editor behavior.
Built HTTP regression mutates identical shadow IDs and verifies the scoped
native contents/version identity remain unchanged, including process restart.
MastraEditor agent `update()` activates a new version. Therefore Studio uses
native `agents.createVersion()` for draft-save and restore-as-draft. Activation
is a separate explicit native pointer update guarded by expectedActiveVersionId.
A Postgres advisory lock serializes competing native transitions across replicas;
failed unlock destroys the connection. No process-local queue is authoritative.

The installed Editor prompt convenience getter ignores its draft selector.
Studio reads exact versions from native storage. Pinning an agent alone also
does not pin referenced mutable blocks: admission resolves both exact native
agent/block snapshots and template context, then records agent, block and final
effective-byte SHA-256 digests on the canonical attempt. Hosted execution uses an
unregistered Agent with `editor: false`, fixed tools/model and those exact bytes.
Legacy Workspace, Seeker and Langfuse do not supply Studio instruction authority.

## Admission, replicas and failures

Freeze signs native snapshot IDs, effective digests, operator, project, revision,
message digest and resolved language context. Canonical Admin admission hashes
the effective message/project digest through `executionInputDigest`, so changed
messages cannot reuse an idempotency receipt. After obtaining that canonical
attempt, the trusted Manager adapter binds its ID into a signed admission. Run
rejects unbound or altered identities, reconstructs only pinned native versions,
and verifies their exact effective digest before any provider call.

Migration `apps/mastra/migrations/004-studio-agent-execution.sql` contains only
execution metadata. Its primary key matches Admin's varchar(128) attempt IDs;
Admin uses cuid values, not UUIDs. Atomic insert claims an execution once across
replicas. A completed or failed claim cannot run again. A process crash can leave
`running`, which means ambiguous and consumed; operators inspect that attempt
and explicitly create a new request identity. No sticky routing or second prompt
body database is required. A dispatch error before ownership is established must
not finish another caller's attempt. Manager only records completion after its
own run request received the successful streaming response. A duplicate loser
cannot replace a live winner's terminal outcome.

## Extension seam for feat-458

`studioRequestSchema.executionInputDigest` is a bounded digest extension for
canonical attempt identity, not a place to store prompt bodies. The GENERATION
flow here produces proposals and records diagnostics; it does not attach
narration or render assets. Feat-458 owns canonical atomic narration attachment
and linked timing ripple. It must include effective approved speech (including
bridge and settle) in provider/cache identity and consume the same native-byte
admission seam. Do not emulate attachment with client patches or mint interactive
assertions for a delegated agent. Source capture/read, asset and Content Pack
discovery, and scoped component transfer reuse 455/456 public commands; codec
materialization remains the existing trusted broker's responsibility. Catalog
staging remains service-only and hidden.

## Configuration for a later reviewed rollout

Keep `STUDIO_AGENT_ENABLED=false` until the normal deployment flow has applied
Mastra migration 004 and configured the narrow transport. Manager reuses the
456 server-only signing key and key ID; Admin and Mastra receive the matching
public-key map and environment. Mastra also needs `STUDIO_ADMISSION_SECRET`,
`STUDIO_ADMIN_URL` and its fixed `STUDIO_AGENT_MODEL`. The native schema is
initialized by the native provider after authenticated access. No generic
Editor record needs to be seeded or migrated.

Manager's Auth issuer and Studio MCP resource audience must match Auth's seeded
`studio-mcp` resource/environment. `STUDIO_MCP_CLIENT_IDS` optionally restricts
client IDs further; it never replaces consent scopes or current Operator checks.
First instruction activation remains an explicit interactive operator action.
No configuration or production rollout was performed by this implementation.
