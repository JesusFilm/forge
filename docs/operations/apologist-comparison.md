# Temporary Apologist comparison

The feature belongs to feat-601 and is restricted to selected internal testers.
It is default-off and must be removed before public Chat release; follow
[feat-602](../roadmap/ai-chat/feat-602-remove-apologist-comparison.md).

## Configuration and enablement

All settings are server-only and are read by
`apps/chat/src/features/apologist/server/config.ts` and `gate.ts` at request time.
Do not put these values in browser configuration or commit credentials.

| Setting                            | Required value                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `APOLOGIST_COMPARE_ENABLED`        | Literal `true` enables capability; all other values deny.                                |
| `APOLOGIST_ALLOWED_EMAILS`         | Small, named internal tester CSV; normalized verified email must also pass Seeker.       |
| `APOLOGIST_API_URL`                | Verified Core Apologist gateway base URL, HTTPS, no embedded credentials/query/fragment. |
| `APOLOGIST_API_KEY`                | Authorized gateway credential from the approved secret store.                            |
| `APOLOGIST_MODEL_ID`               | Explicit operator-verified model ID; there is no inferred default.                       |
| `APOLOGIST_ALLOWED_HOSTS`          | Exact gateway hostname CSV; no wildcard or suffix matching.                              |
| `APOLOGIST_LANGFUSE_BASE_URL`      | Core production prompt project's HTTPS base URL.                                         |
| `APOLOGIST_LANGFUSE_PUBLIC_KEY`    | Core prompt-project public key.                                                          |
| `APOLOGIST_LANGFUSE_SECRET_KEY`    | Core prompt-project secret key.                                                          |
| `APOLOGIST_LANGFUSE_ALLOWED_HOSTS` | Exact prompt-server hostname CSV.                                                        |

Normal Chat startup never validates these optional settings. Missing provider
configuration produces a pane-local unavailable error; missing prompt access
produces a visible fallback notice attached to that answer. Neither is evidence
that production parity has been established.

On 2026-10-02 the operator confirmed that the configured gateway URL/key match
Core and that the production prompt project and intended version are correct.
The local browser integration successfully used production prompt version 9.
Forge intentionally uses `openai/gpt/4o-mini` instead of Core's operator-reported
`google/gemini/3-flash`; this is not an exact reproduction of Core's model
configuration. The operator reported HTTP 422 failures with Core's model ID during
the prototype investigation and found it unsupported. Core's update before the
Christmas campaign is tracked in
[NES-1895](https://linear.app/jesus-film-project/issue/NES-1895/update-production-apologist-model-id-before-the-christmas-campaign),
not a blocker for this temporary comparison.

Source comparison against Core commit `9f6f8044e6a9cdac133f217f3ef2741b7b9ccc25`
confirmed both integrations set 512 output tokens and omit explicit temperature,
top-p, and penalties. Retain the approved model choice; do not silently substitute
another model or inherit Core's optional provider selector.

The adapter uses AI SDK 6 with a system message, plain text user/assistant
messages, and 512 output tokens. It explicitly requests
`apologist-world-cup-chat` with `label=production`, compiles English/ESV, and
retains Core's respond-in-the-user's-language fallback instruction. Successful
prompts cache for at most 60 seconds. Unsupported templates, failed reads, and
failed refreshes use the fallback visibly; they never claim production provenance.
No Forge-owned Apologist generation tracing is added.

Deploy only through the normal PR-to-main flow, initially with comparison off.
Supply verified configuration through the normal secret/configuration process.
Verify a controlled two-turn conversation, cancellation, per-answer prompt
provenance, and Forge-only replay before enabling for the selected roster.
Production enablement remains outstanding: install the approved settings and exact
host pins in Forge production, configure the selected tester roster, and perform
the deployed smoke and disablement checks through the normal rollout process.
The operator confirmations and local browser checks do not replace these deployed
checks. No further Core model-parity or prompt-ownership attestation is required
for this accepted configuration.

## Behavior and bounds

One shared question addresses both providers, each with its own history. Only
Forge persists through the existing Mastra session. Refresh, navigation, New,
and Return to Forge discard the temporary Apologist transcript. Local disposal
does not erase any records retained by the gateway or its providers.

Questions over 4,000 JavaScript string units are rejected before either send;
the draft remains editable. Apologist requests allow 40 messages, 4,000 units
per text field, 40,000 total units, and 256 KiB bytes. History is never silently
truncated. Partial assistant text is retained as context; error notices are not.
A history cap recommends New conversation. Both attempts must settle before
another question is admitted; Stop cancels outstanding attempts.

The server applies a 95-second request deadline and a 5-second prompt deadline.
Prompt JSON is capped at 64 KiB, gateway streams at 1 MiB and answers at 8,192
characters. Every credentialed fetch rejects redirects and off-list hosts.
Client cancellation propagates upstream. Errors expose fixed reason codes only,
never raw provider errors, keys, prompt bodies or identity data.

## Rollback

Disable `APOLOGIST_COMPARE_ENABLED` through the normal configuration rollout.
New requests from already-open tabs refuse after the new configuration is active.
Existing streams may finish until stopped, disconnected, or their deadline.
Forge's own switch, session cookie, history, credentials and telemetry remain intact.
Disabling is rollback; it does not satisfy the public-release removal requirement.

## Removal

Use feat-602's explicit deletion boundary and keep-list. Remove feature code,
route, page capability wiring, shell entry, dedicated tests and now-unused SDK
dependencies, then regenerate the lockfile. Remove the read-only snapshot
exposure if no other caller uses it. Delete deployment settings in a separate
operator step after the code is removed; do not rotate or delete shared Core
credentials. Re-run ordinary Chat auth, history, deep-link, rename, source,
video, follow-up, streaming and loading checks.
