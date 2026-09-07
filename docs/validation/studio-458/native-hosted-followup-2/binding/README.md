# Unpaid native binding and dry validation

No paid execution is authorized or performed. `bound-proposal.body` is immutable,
SHA-256 `8bf886ca002a8cb8cd8293738ea3c12ada844e99bbebed5993edfce7eb4ebf7c`.
It references original proposal
`acc28d6896a79578906d57a299895dc20e3dd3952d992b306af861def4578719`,
which remains unchanged. Its inherited instructionPreparation section is the
historical plan; binding and frozenNativeInstructions record the actual result.
No correction to approved bytes, model, cases, messages or limits was necessary.

Through the trusted interactive Manager API, the exact draft was saved, compared
with the previous active version and explicitly activated in the isolated native
PostgresStore. Save left the old active version unchanged. Activation selected
`0dbac07a-9c33-4f02-906f-01065e57c36f`; old versions were not edited. The native
freeze uses unchanged block `b0afa872-cfb6-4ece-a01e-ee66f3557e6a`, agent digest
`bda39c132d881151c66319dda9bbb8ad3987fa805ec07ba45dba82731169222d`,
and effective digest
`9afe8339baaac0b7b458d17a73f43da8f6edb59c47154e4a132cbc1b7e0a521b`
(9,113 UTF-8 bytes). `activation-evidence.json` and `activated-frozen.json` retain
actual native responses. `closed-version-refrozen.json` proves the old explicitly
pinned snapshot still resolves to its original bytes.

Fresh guard validation passed six tests, including 2/5/10 exhaustion, restart,
concurrent losing claim, oversized/settings/admission rejection, ambiguous/no
replay and unowned completion. The execution-boundary allowlist test also passed.
Guard and CLI copies are unchanged; test setup points to this bound proposal.
The native dry adapter intercepts provider transport with synthetic SSE and an
unused fixture credential. There is no network-forwarding model adapter here.

Actual production Manager generation controls admitted both exact r1 saved cases
through the current scoped native runtime. They made four synthetic requests each,
eight total, with 4,096 output cap on every request. Maximum observed serialized
UTF-8 plus 4,096 framing bound was 151,002, below 200,000. All observed admissions
match the approved documents/messages and new frozen IDs/digest. Both runs retained
proposals, with zero page errors, provider calls, apply or approval. See
`dry/hosted-dry-evidence.json`, request/response bodies, screenshots, observed rows
and summary.json. This fixture validates transport and guards, not creative quality.

The distinct DRY ledger is
`/tmp/forge-studio-458-runtime/native-paid-guard/creative-followup-2-dry.sqlite`.
Its eight completed synthetic claims remain retained; it must not be reset or used
for LIVE. The distinct proposed LIVE ledger does not exist. Both previous paid
batches remain closed and untouched. Any future LIVE run still needs explicit
coordinator release, exact current frozen/project/pack/asset preflight, this bound
proposal hash and the same read/proposal execution allowlist. No fallback, retries,
replacement admissions, media, registration, apply, approval or publication.

Fresh read-only GETs to the existing OpenRouter key and exact model endpoints
returned HTTP 200. Sanitized evidence records remaining key allowance 9.8840917 USD
and OpenAI route rates 0.75 USD/M input, 4.50 USD/M output, with supported output
capacity above 4,096. The proposed standard bound remains 1.68432 USD within a
2 USD ceiling; no actual charge is inferred. No credential/account change or paid
probe occurred. Model web-search pricing does not authorize web-search tools.

Post-run exact project/pack/source asset checks passed. The active corrected native
version is intentionally retained; the original proposal, old native version bytes,
closed ledgers and committed evidence remain unchanged.

Service changes were journaled before stopping processes. Only owned Manager3588
was restarted to point at temporary dry native4189, then restored to its prior
fixture4188. Temporary dry4189 was stopped after completion. Admin, preview,
baseline, PG, Redis, assets and all other fixture state remain available. The
mutation-intent and service-change/restore-intent files record the exact scope.
