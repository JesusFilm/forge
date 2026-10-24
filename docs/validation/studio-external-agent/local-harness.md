# Local actual-client editing qualification

## Recorded outcome

Codex CLI `0.150.0-alpha.12.2`, using the operator's existing ChatGPT login,
completed real MCP discovery, creation, read, edit, identical retry, attributed
history, and link resolution. Its persisted conversation
`01a0cc79-3848-7a60-bc2b-a9dbd0281321` was resumed between initial creation and
successful editing, proving reconnect/resumption against canonical state.
[The selected actual tool transcript](codex-local-edit-evidence.json) records
arguments, canonical outcomes and the initial rejected edit.

Project `codex-local-proof-542` is revision 2, titled `Codex revised draft`, with
actor `shorts-local-qualification`, authority `delegated`, client
`codex-local-qualification`. The repeated exact edit returned the same revision 2
receipt. History contains both revisions. No provider was called.

The first model attempted JSON Patch (`op: replace`, `path: /title`) instead of
the advertised domain operation; it was rejected without mutation. Resuming with
`{kind: "set-metadata", title: "Codex revised draft"}` succeeded. The portable
skill must teach domain commands explicitly. The first CLI attempt also exposed
an execution restriction: `default_tools_approval_mode="auto"` under noninteractive
`never` approval blocked even discovery. This authorized local-only harness uses
`approve` on the six explicitly allowlisted tools; it changes no saved user
configuration.

## Boundary and remaining acceptance

The harness invokes the real Manager MCP handler, OAuth JWT/JWKS verification,
Manager-to-Admin Ed25519 signing, real Admin session/delegated handlers, current
Operator membership, canonical authoring services, and isolated real Postgres.
There are no mocked authoring implementations. The HTTP adapter substitutes only
for Next's network host. The local RSA issuer substitutes for production Auth;
the server-to-server session check uses the existing local service-bearer path.

This proves **real Codex MCP editing with authenticated local transport**. It does
not prove production OAuth registration/consent, token refresh, deployed network
reachability, Claude support, rendering/inspection/narration, or editor UI
observation. The editor URL in this harness has no UI server. Full-workflow
qualification and UI observation remain separate gates. Subscription inference
is outside Studio provider accounting.

## Reproduce

Use the task-owned database provisioned by the coordinator and its migrations.
The bootstrap refuses every URL except the existing guarded loopback test URL;
it never migrates, truncates, or modifies another database. Install dependencies
normally so package aliases and generated Prisma clients match this checkout.

```bash
STUDIO_TEST_DATABASE_URL=postgresql://tataihono@127.0.0.1:55460/forge_studio_460_fresh \
  node scripts/studio-agent-local/start.mjs /absolute/private/qualification-output
```

This listens on loopback ports 55470 (test issuer), 55471 (Manager MCP) and 55472
(Admin). It creates only the disposable Operator if absent, generates ephemeral
signing keys/token, writes private environment/token files outside the checkout,
and records header-free MCP calls in `mcp-audit.jsonl`. Expiry is one hour.
Production, publication, hosted agent, and render-pool gates are disabled. Both
application processes reject fetches to non-loopback hosts, preventing paid
provider requests. The harness does not expose fake provider completion as real
provider evidence. Shut it down with Ctrl-C; the bootstrap terminates its process
groups. Do not commit its token or environment files.

Write a prompt file asking for the six authorized operations and supplying a
unique project ID/idempotency keys plus a valid empty Studio document. Then run:

```bash
codex --version
codex login status
node scripts/studio-agent-local/run-codex.mjs \
  /absolute/private/qualification-output /absolute/prompt.txt initial
```

Use only an already authenticated client. The runner adds the local MCP server
for that invocation, allowlists `shorts.projects`, `shorts.resolveProject`,
`shorts.read`, `shorts.create`, `shorts.apply`, and `shorts.history`, and injects the
local token through `SHORTS_QUALIFICATION_TOKEN`. It never places a token in the
prompt or command-line arguments. Inspect actual tool outcomes in
`initial-transcript.jsonl`: a zero process exit alone is not success. Read the
`thread.started` ID and pass it as the final argument to reconnect:

```bash
node scripts/studio-agent-local/run-codex.mjs \
  /absolute/private/qualification-output /absolute/resume-prompt.txt resumed <session-id>
```

Codex's documented HTTP MCP URL, environment-backed bearer, OAuth and tool
approval settings are described in the [official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
The exact installed CLI version and actual transcript remain the evidence for
this local run.

## Actual editor UI companion

The optional companion runs the real Next Manager app with the same signing
keys, real session validation, and real Admin interactive dispatcher:

```bash
node scripts/studio-agent-local/start-ui.mjs /absolute/private/qualification-output
```

Open `http://127.0.0.1:55471/local-session` in the test browser. This local fixture
endpoint mints a real Manager session cookie for the disposable Operator and
redirects to the real editor list on port 55473. Open the project created by the
client to observe history and direct-edit it. This endpoint exists only in the
script host, never the production application. It bypasses only the interactive
Auth login ceremony; Manager still revalidates actual database membership and
signs requests to Admin's actual `/api/shorts/interactive` handler. Cookies are
shared by host across ports: use a disposable browser context to avoid affecting
other localhost Manager sessions. The fixture cookie expires in one hour.

The minimal Admin host does not expose general GraphQL, so unrelated Manager
coverage/language background warmers report 404. Studio's canonical interactive
HTTP path remains real. This harness is a targeted Studio qualification substrate,
not a replica of every Manager service. The Next UI companion has no provider
credentials and disabled production gates; do not add real credentials.

## Full-workflow extension seam

Later qualification should extend these handler hosts with real routes, loopback
canonical catalog/source fixtures (synthetic HLS/VTT), approved existing-voice
fixtures with deterministic fake provider execution, and actual contained renderer
output. Keep synthetic provider evidence distinct from authorized paid-provider
qualification. Do not substitute fabricated rendered evidence or general HTTP
probes for the client's actual inspection calls. Use a fresh random project ID
and stable per-run idempotency keys for each full run; do not delete immutable
history or require cleanup to replay the recorded fixed-ID example.
