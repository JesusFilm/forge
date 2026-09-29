# RAG Consumer Manual: governed test-bench execution

## Problem Statement

The first manual release intentionally shows a disabled bench and sample output.
Consumers still need to try a query with the selected policy and inspect real
passages. A shared interactive bench can consume embedding capacity, database
time and response memory, while an untracked or browser-exposed credential would
make attribution and emergency shutdown unreliable.

## Solution

Enable a bounded, authenticated test bench using one dedicated test-bench consumer
owned by Jaco. Keep its credential on the RAG server in Railway variables, route
every query through normal registered-consumer authentication and usage accounting,
and add a default-off execution flag plus conservative limits. Replace the sample
output with idle, pending, success, empty and error states backed only by real
requests. Preserve the existing two-pane code/request presentation and show the
actual effective policy used for the run.

This is the deferred second phase. The current PR publishes planning documents
only. It does not create a consumer, issue a token, mutate Railway configuration,
enable the UI or run any query.

## User Stories

1. As an admitted consumer developer, I want to type a query in the manual, so that I can test the selected use case.
2. As a consumer developer, I want the query to use the visible policy and dropdown values, so that results answer the experiment I configured.
3. As a consumer developer, I want the system to supply bench credentials securely, so that I do not need to paste an API token into the page.
4. As a consumer developer, I want one Run action to dispatch one request, so that double clicks cannot produce accidental traffic.
5. As a consumer developer, I want a visible pending state and cancellation on navigation, so that I understand when work is in progress.
6. As a consumer developer, I want scored passages, source citations and available document text, so that I can assess retrieval quality.
7. As a consumer developer, I want raw response JSON, so that I can understand what my integration will receive.
8. As a consumer developer, I want zero results clearly distinguished from an error, so that I can decide whether to change the query or retry later.
9. As a consumer developer, I want a concise explanation when a bench limit changes my policy, so that the observed results are not falsely attributed to my original settings.
10. As a consumer developer, I want code and request.json to match the effective policy, so that I can reproduce the request using my own credential.
11. As a consumer developer, I want old results marked stale after a query or policy change, so that I do not mistake them for a fresh run.
12. As a consumer developer, I want synthetic samples removed from the runtime view, so that every displayed result is an actual response.
13. As a consumer developer, I want the manual and copy controls to remain useful when execution is disabled, so that shutdown does not remove the documentation.
14. As Jaco, I want a named test-bench consumer under my ownership, so that access, rotation and usage have a clear owner.
15. As Jaco, I want bench calls visible in the existing Usage page, so that I can see how much traffic this feature creates.
16. As an operator, I want a Railway execution flag that is off by default, so that I can enable deliberately and stop abuse.
17. As an operator, I want missing or malformed settings to disable the bench, so that bad configuration cannot widen access or break unrelated service traffic.
18. As an operator, I want a server-held registered-consumer token, so that browser inspection cannot reveal a reusable shared credential.
19. As an operator, I want token rotation and revocation to use the existing lifecycle, so that the bench does not introduce a second credential system.
20. As an operator, I want a source allowlist enforced by the consumer token, so that UI manipulation cannot expand corpus access.
21. As an operator, I want hard result-count, query-size and score limits, so that a visitor cannot request an expensive broad sweep.
22. As an operator, I want full documents off initially and bounded when allowed, so that a few large documents cannot exhaust response memory.
23. As an operator, I want database, provider and total request deadlines, so that timeouts actually stop or contain expensive work.
24. As an operator, I want user and shared rate limits plus a global concurrency limit, so that multiple sessions or replicas cannot bypass the budget.
25. As an operator, I want rejected requests to stop before embedding whenever possible, so that denial does not itself create substantial cost.
26. As an operator, I want direct requests using the dedicated identity to obey the same guardrails, so that bypassing the portal route cannot bypass governance.
27. As an operator, I want shutdown, error and usage evidence without secrets or corpus text, so that operational proof is safe to retain.
28. As another RAG consumer, I want bench policies isolated to the bench identity, so that this feature does not change my retrieval behavior or budget.
29. As an unauthenticated or removed portal user, I want execution rejected consistently, so that old browser state cannot retain access.
30. As an implementer, I want local browser and HTTP tests with synthetic data, so that proving the feature does not require production load or real credentials.

## Implementation Decisions

### UI activation and result lifecycle

- Depend on the manual UI delivered by phase one. Preserve the approved combined layout; enable the existing bench controls only after the server reports a currently valid execution capability.
- Remove sample results from shipped runtime assets in this phase. There is no fallback from a live failure to synthetic data. Keep synthetic fixtures only in local automated tests. Initially display an empty instructional state, then actual results or a precise error.
- The page never asks for, displays or copies the bench token. Ordinary generated examples still use RAG_API_TOKEN with a replacement placeholder for the integrating consumer's own credential.
- The browser submits one canonical query/policy to a same-origin portal route, proposed POST /portal/manual/query. Reject unknown fields and browser attempts to supply a token, target URL or consumer ID. The server is the authority for capability and limits even if a user edits the page or calls the route directly.
- Support idle, pending, success, empty, error and unavailable states. Disable duplicate Run actions while pending. Abandon stale responses after navigation, sign-out, scenario changes or cancellation; a late response must never overwrite a newer run.
- Editing the query or policy marks existing output stale until rerun. A new failure does not leave old output looking like successful output for the new request. No query or result history is persisted by default.
- Show result count and client-observed elapsed time after an actual run, citations, scores, matched text and full text only when present. Scores remain similarity values. Raw JSON exposes the retrieval response with any portal-only execution metadata clearly separated. Safely render text and allow only safe citation URLs.
- An off switch or invalid capability disables the entire execution area. Clear live output on sign-out or admission removal. Code generation and static teaching remain available to admitted users even while execution is unavailable; retain real output only as clearly historical/stale during an ordinary capability refresh, never as a new success.

### Dedicated consumer, credential and accounting

- Provision a normal registered consumer named test-bench through the existing portal management lifecycle. Resolve Jaco's current admitted GitHub identity; the current allowlist identifies jaco-brink. Make Jaco an owner and preserve the existing last-owner rule. Do not invent a static legacy bearer or bypass the registry.
- Give it an explicit reviewed source-key allowlist. Start from the configured approved source envelope and narrow if needed; do not grant wildcard access or automatically add future sources. The dropdown metadata envelope and query eligibility intersect that consumer's current permissions at execution time.
- Store the active credential only in Railway RAG_TEST_BENCH_API_TOKEN, with the approved vault/secret workflow and restricted visibility. Pin the expected registered consumer identifier through RAG_TEST_BENCH_CONSUMER_ID so accidentally supplying another consumer's key cannot misattribute traffic or bypass bench controls.
- No credential is included in HTML, JavaScript, capability/metadata responses, browser storage, copied code, client errors, logs, traces, screenshots or PR evidence. Never log query text or retrieved corpus content as operational proof.
- Execute using the dedicated bearer through the existing POST /v1/search authentication, scope intersection and usage-admission path. An in-process HTTP dispatch into the existing app boundary is acceptable and avoids a user-selectable upstream URL. Do not call the retriever directly and reconstruct only part of authentication/accounting.
- Mark the dedicated identity durably in the registered-consumer control plane, independently of optional environment values. Extend the internal authenticated principal with that server-owned purpose marker if needed; ordinary create/edit clients cannot assign or remove it. The marker must survive missing/invalid environment configuration and token rotation, so a direct bearer cannot fall through to unrestricted ordinary-consumer behavior when a configuration value disappears. The pinned environment ID is an additional identity check, not the only way to recognize bench traffic. This may require a narrow control-plane schema migration; no corpus schema change is needed.
- Apply bench identity guardrails at the authenticated execution boundary as well as portal admission checks. A request presenting the dedicated bearer directly must still obey the enabled flag, resource limits, shared rate/concurrency budget and source policy. Other registered consumers retain their existing behavior. Per-user budgets additionally apply to authenticated portal requests, using the immutable current GitHub identity rather than a client-supplied ID.
- A dispatched request is admitted/accounted exactly once under test-bench. The portal wrapper does not add a second consumer usage record. Rejections before dispatch use bounded denial telemetry and do not fabricate successful searches. Preserve existing accounting semantics for authenticated validation errors; document which layer produced each rejection.
- Demonstrate test-bench in the existing Usage list and date-range reports after bounded synthetic local runs and the later approved live smoke. Verify completion/error counts using the collector's actual flush/persistence behavior, not only a mocked increment.

### Railway governance contract and starting defaults

These are proposed initial configuration values for the later implementation and
rollout. They are not existing deployed variables. Validate the complete set
before exposing capability. Every limit is enforced server-side; a UI maximum
is guidance only. The conservative values require local load evidence before
activation and review before any later increase.

| Variable                                  | Initial value                             | Required behavior                                                                                                        |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| RAG_TEST_BENCH_ENABLED                    | false                                     | Only exact validated true permits execution; unset/false disables.                                                       |
| RAG_TEST_BENCH_API_TOKEN                  | secret, unset until provisioning          | Required for enablement; authenticates as the dedicated registered consumer.                                             |
| RAG_TEST_BENCH_CONSUMER_ID                | registered UUID, unset until provisioning | Pin token ownership and identify bench requests at the public execution boundary.                                        |
| RAG_TEST_BENCH_DEFAULT_TOP_K              | 3                                         | Default when a bench request omits topK.                                                                                 |
| RAG_TEST_BENCH_MAX_TOP_K                  | 5                                         | Absolute configured maximum for the effective request; code-level ceiling 10 and public contract ceiling 50 still apply. |
| RAG_TEST_BENCH_DEFAULT_MIN_SCORE          | 0.45                                      | Default when omitted.                                                                                                    |
| RAG_TEST_BENCH_MIN_SCORE_FLOOR            | 0.37                                      | Bench-only minimum; cannot be configured below 0.35 without a reviewed code change.                                      |
| RAG_TEST_BENCH_DEFAULT_LANGUAGE           | en                                        | Default when omitted; validate the configured code. Show its use in the effective policy.                                |
| RAG_TEST_BENCH_DEFAULT_INCLUDE_DOCUMENT   | false                                     | Default when omitted; true is invalid unless full documents are allowed and bounded.                                     |
| RAG_TEST_BENCH_ALLOW_FULL_DOCUMENTS       | false                                     | Initial enablement returns passages only. True requires the bounded document-read path and its tests to be implemented.  |
| RAG_TEST_BENCH_MAX_QUERY_CHARS            | 500                                       | Reject overlong queries before embedding; positive and no higher than the public contract's 2000.                        |
| RAG_TEST_BENCH_MAX_REQUEST_BYTES          | 8192                                      | Reject oversized encoded bodies before parsing; include policy arrays and keys.                                          |
| RAG_TEST_BENCH_MAX_RESPONSE_BYTES         | 262144                                    | Bound the actual serialized response, including metadata/JSON envelope; code-level ceiling 1048576.                      |
| RAG_TEST_BENCH_MAX_DOCUMENT_BYTES         | 32768                                     | Per-document bound enforced before materializing/assembling the full body; never label a truncated document complete.    |
| RAG_TEST_BENCH_TIMEOUT_MS                 | 5000                                      | Total request budget, including retrieval and response handling; code-level ceiling 10000.                               |
| RAG_TEST_BENCH_DB_TIMEOUT_MS              | 1500                                      | Transaction-local database statement deadline, bounded by total budget.                                                  |
| RAG_TEST_BENCH_USER_REQUESTS_PER_MINUTE   | 6                                         | Rolling per-admitted-user budget; includes dispatched failed attempts.                                                   |
| RAG_TEST_BENCH_GLOBAL_REQUESTS_PER_MINUTE | 30                                        | Shared bench-consumer budget across portal sessions and service replicas.                                                |
| RAG_TEST_BENCH_MAX_CONCURRENT             | 2                                         | Shared in-flight budget across replicas; no unbounded waiting queue.                                                     |

- Parse booleans/numbers strictly; reject NaN, infinity, non-integers where required, zero/negative limits, unsupported language values and contradictory bounds. Require default topK no higher than max, minimum/default scores within zero to one, and database deadline below total deadline. Reject configurations that exceed code-level safety ceilings. Misconfiguration disables this capability with a sanitized operator diagnostic; it must not prevent unrelated RAG service startup or health.
- Expose only a sanitized capability view: available state, user-relevant limits and non-secret effective defaults. It must not expose the token, credential verifier, database URLs or arbitrary environment values. Recheck authorization and admission on every query; a previously fetched enabled capability is not authority.
- Derive one effective bench policy from the selected preset, dropdowns, server defaults, consumer scope and hard caps. Reconcile safe caps into visible controls before running, mark the preset as adjusted where necessary, and update behavior visuals, request.json and all code tabs together. No silent change between visible request and execution. A direct/tampered request beyond caps is rejected rather than silently normalized behind the user's back.
- In particular, the original Coverage audit preset of 50 results cannot execute as-is under a maximum of 5; the visible bench policy must reflect the smaller limit. Full-document presets visibly become passage-only while the allowance is false. Do not keep Full text included or copy a true value while running with false.
- All permitted means the current dedicated consumer scope, not every source in the database. Explicit allowlists only narrow it; an empty allowlist returns zero results without embedding. Preferred sources outside the effective scope are rejected or visibly cleared before a run, never used to widen it. Category/language filters retain exact retrieval semantics.
- Store environment values in the fixed Railway forge / production / @forge/rag service using the existing secret procedure. A Railway variable change takes effect when applied to every serving instance through the platform's normal deployment/configuration lifecycle; do not promise an instant in-memory switch from an environment edit. Document the observed propagation time and verify every active replica is off. Existing consumer revocation is the independent emergency control while configuration propagates.

### Resource bounds that protect actual work

- Reject disabled capability, invalid session/origin, wrong identity, bad schema, query/body limits and disallowed policy before embedding or vector work. Use the existing corpus read-only path. No ingestion or database writes to corpus tables are introduced.
- Result count alone is insufficient: the candidate fan-out, database execution, provider requests and response materialization must all be bounded. Derive candidate work from the capped topK and prove the existing fan-out calculation cannot exceed the bench's intended budget.
- Carry a total deadline through the actual embedding request and retrieval work. Use real AbortSignal support for network operations and transaction-local statement timeouts for Postgres. A timeout response or Promise.race without stopping/containing the database/provider work is not sufficient. Cancellation must release resources and concurrency permits when the underlying work ends, not merely when the browser disconnects.
- Permit admission must be atomic across all deployed replicas. Use the existing RAG Postgres operational/control surface for narrow rate/concurrency coordination if no suitable shared limiter exists. Keep it separate from corpus writes, use least-privilege grants, bounded rows and expiring leases with crash recovery. Do not use a per-process map as a global cap or allow a queue to accumulate beyond the concurrency budget.
- Track both per-user and global budgets. Browser refresh, new sessions, spoofed client IDs or load balancing must not reset them. Rejected admission returns a bounded 429 response with Retry-After. Handle storage failure by denying bench work rather than disabling the limiter. Lease release must occur on success, failure, cancellation and timeout; lease expiry must not admit replacement work while an uncontained old operation can continue indefinitely.
- Keep full-document loading off initially. If enabling it is supported in this ticket, add a bounded read mechanism that checks body size inside the database before fetching/assembling it in application memory. Refuse oversized bodies with a clear bench limit error; do not fetch everything and truncate afterward, issue an extra unconstrained detail endpoint, or call a truncated string a full document.
- Bound matched passages and metadata as part of the serialized response budget too. Check bounded data projections before large materialization, then verify the real UTF-8 serialized payload including JSON escaping/envelope. A bytes estimate that omits titles, tags or URLs is not evidence. Oversized results produce a typed limit error; no silent truncation of citations or document semantics.
- Avoid automatic retries, batch mode, automatic fallback queries or hidden multi-pass execution. One deliberate Run is one governed search. Capability and option reads remain cheap and cached; fetching the manual must not consume an embedding budget.

### Activation, rollback and ownership

1. Implement and prove the complete local flow with a disposable database, synthetic registered consumer, deterministic embedder, real HTTP accounting, configured bounds and the disabled default. Remove runtime sample fixtures.
2. Merge reviewed code through the normal PR-to-main flow. Keep execution disabled while deployed code and operational configuration are prepared.
3. Confirm the fixed Railway service/environment, Jaco's current admitted identity and owner relationship. Create or verify exactly one test-bench consumer using the existing management path; review source scope and record its non-secret identifier. Do not silently take ownership of an unrelated pre-existing consumer with that name.
4. Issue/rotate the credential through the existing lifecycle, transfer it via the approved vault to the Railway server variable, and pin the consumer ID. Suppress intermediate configuration deploys where supported. No secret appears in chat, PRs or command output.
5. Set every governance variable explicitly to the reviewed initial value, validate configuration without printing values, and confirm it authenticates the pinned consumer. Verify normal consumers and the manual still work while the flag is false.
6. With the owner's operational authorization, enable and run a small bounded smoke: one valid query, one scoped/empty case, one limit refusal, observed dedicated-consumer Usage reporting, and a disable/revocation rehearsal. No production load test or corpus export.
7. Verify the deployed UI contains no sample output or token input, code copies only placeholders, every active replica honors off, and permitted normal traffic remains unaffected. Record deployment/configuration identifiers, counts, timings and outcomes only.
8. Retain the disabled default as rollback. On abuse, disable execution and apply the configuration; revoke the dedicated credential if immediate containment is needed. Re-enable only after the owner has reviewed scope/limits and the fresh credential is validated. Rotation/revocation does not affect other consumers.

## Testing Decisions

- Use the authenticated HTTP boundary as the main execution seam, composed with the existing consumer lifecycle and Usage reporting. Add browser journeys only to verify the actual user flow and absence of secrets/sample output; do not build a parallel test-only query API.
- Prior art includes registered-consumer HTTP lifecycle integration, HTTP usage/admission tests, Postgres usage persistence/role tests, deadline handling and the existing portal browser harness. Keep a deterministic local embedder and synthetic corpus; use real local Postgres for authorization, metadata, coordination and bounded query behavior.
- Test the whole deny matrix: missing/false/malformed flag; missing or mismatched token/consumer pin (including a direct dedicated bearer after configuration is removed); invalid numeric combinations; expired/removed user; wrong Origin/cross-site requests; unknown fields; browser-supplied bearer/URL/consumer ID; invalid or overlong query; request bytes; excessive topK; score below floor; prohibited full documents; out-of-scope sources; revoked/rotated credentials. Assert no expensive work occurs after a preflight denial.
- Show that the copied request, effective policy, outgoing authenticated request and returned results agree. Test all initial presets, especially the broad and full-document presets constrained by bench defaults, and metadata changes between option load and Run.
- Run multiple authenticated users against at least two app instances sharing one database. Verify rolling limits, global concurrency, no queued accumulation, permit release, failure to acquire safely, crash/lease recovery and prevention of direct-bearer bypass. Falsify a process-local limiter to demonstrate the test can catch it.
- Exercise slow/aborted embedding, slow Postgres, oversized documents and responses, escaped Unicode/control characters in payloads, and client disconnect. Verify underlying work is cancelled/bounded and permits are not released early. Assert that the document-fetch path is never called while full documents are disabled.
- Verify one dispatched run contributes exactly one request to the dedicated consumer's persisted usage, with correct success/failure accounting, and none to an arbitrary user's consumer. Flush/reconcile as the production collector requires. Denials before dispatch remain distinct from completed searches.
- Browser tests cover idle/pending/success/empty/error/off, repeat clicks, cancellation, stale output after edits, late responses, sign-out and safe citation rendering. Inspect assets, DOM, storage, network and copied text for a synthetic secret sentinel; it must never be present. Assert runtime sample fixtures are absent.
- Measure page loading and a controlled local concurrency/latency comparison with an ordinary consumer. Prove bounds protect shared resource usage, not just visible response time. Record the fixture and configuration so evidence is reproducible; production receives only the bounded authorized smoke.
- Confirm these test boundaries with Jaco as required by the to-spec workflow and carry any accepted adjustment into implementation.

## Out of Scope

Building the initial manual page (phase one), new consumer-neutral retrieval
fields, LLM generation or translation, query batching, scheduled load tests,
public anonymous access, user-supplied bench tokens, changes to unrelated consumer
limits, a new staging service, corpus mutation/ingestion, or secret values in
repository documentation. Production operational work occurs when this ticket is
implemented and authorized, never merely because the planning PR was merged.

## Further Notes

- Tracker: [feat-576](../roadmap/rag/feat-576-rag-governed-test-bench.md), tagged ready-for-agent and dependent on [feat-575](../roadmap/rag/feat-575-rag-consumer-manual.md).
- UI contract: [manual spec](2026-09-30-001-rag-consumer-manual-spec.md). The future bounds are deliberately not enforced as public API changes in the initial manual ticket.
- Operational precedents are the existing consumer-access, consumer-usage and environment/secrets runbooks, with normal Railway deployment and credential lifecycle. The broader usage-capacity review remains relevant before materially expanding bench volume.
- The explicit numerical defaults in this document are proposed engineering starting points, not claims that production capacity has been measured. Enabling requires local evidence and owner-reviewed operational verification.
