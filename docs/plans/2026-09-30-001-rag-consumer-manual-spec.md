# RAG Consumer Manual: scenarios, policy controls, and code samples

## Problem Statement

An admitted RAG consumer can manage credentials and inspect sources but cannot
see how their use case maps to a retrieval policy. The historical Consumer Manual
is a detached HTML prototype with unverified presets and an incomplete view of
the current contract. Consumers need a clear scenario selection, accurate filter
choices from the actual corpus, and portable examples that reflect their choices.

## Solution

Add the Consumer Manual to Knowledge in the existing Forge portal. Combine the
grouped scenario sidebar and heading from concept A with the single vertical
detail panel from concept D. The selected scenario drives compact expected-behavior
visuals, three working database-backed dropdowns, and four language examples with
an adjacent request file. The entire Test bench remains disabled with clearly
labelled synthetic sample output until the separately tracked execution work lands.

The specification and roadmap are local to Forge. This is phase one of two;
publishing this spec does not implement either phase or enable production traffic.

## User Stories

1. As an admitted portal user, I want to open the manual from Knowledge, so that I can learn within the portal I already use.
2. As a consumer developer, I want use cases grouped by Seeker, Believer, and Ministry / org, so that I can quickly find a relevant starting point.
3. As a consumer developer, I want only use-case names in the sidebar, so that repeated subtitles and badges do not obscure navigation.
4. As a consumer developer, I want a clearly selected scenario with one main title and description, so that I understand which policy I am examining.
5. As a consumer developer, I want four concise behavior visuals, so that I can understand result count, score cutoff, language and document payload at a glance.
6. As a consumer developer, I want scores described as similarity, so that I do not mistake a cutoff for answer confidence.
7. As a consumer developer, I want the source dropdown to list actual searchable source keys with readable names, so that I do not copy an invented brand identifier into the API.
8. As a consumer developer, I want to choose several allowed sources or all permitted sources, so that I can demonstrate a bounded source policy.
9. As a consumer developer, I want preferred-source choices consistent with my allowlist, so that a soft preference cannot imply access to another source.
10. As a consumer developer, I want categories loaded from actual searchable documents, so that choices reflect the corpus rather than prototype assumptions.
11. As a consumer developer, I want clear loading, empty and retry states for metadata, so that failure never silently substitutes hardcoded options.
12. As a consumer developer, I want disappearing selections called out without widening scope, so that a refreshed catalog cannot silently alter the request I intend to copy.
13. As a consumer developer, I want scenario and dropdown changes reflected in one request, so that the visuals and copied examples agree.
14. As a consumer developer, I want cURL, TypeScript, Bash and Python tabs, so that I can integrate using familiar tools.
15. As a consumer developer, I want the policy payload in a pane titled request.json, so that I know exactly what file the code expects.
16. As a consumer developer, I want a copy icon in each pane's top-right corner, so that I can copy code or request JSON independently.
17. As a consumer developer, I want copy success and failure feedback for the clicked pane, so that I know whether the intended content reached my clipboard.
18. As a consumer developer, I want examples using a replacement token variable, so that the manual never supplies a runtime service credential.
19. As a consumer developer, I want example strings escaped correctly, so that quotes, Unicode and punctuation cannot break the copied request or execute shell input.
20. As a consumer developer, I want the Test bench visibly unavailable, so that I do not mistake disabled controls or sample output for live retrieval.
21. As a consumer developer, I want the code tabs and dropdowns to work while the bench is disabled, so that I can still learn and build my own integration.
22. As a portal operator, I want this first phase to make no embedding or search calls, so that browsing the manual adds no retrieval traffic.
23. As a portal operator, I want metadata reads authenticated and read-only, so that existing corpus and admission boundaries are preserved.
24. As a keyboard or assistive-technology user, I want named controls, clear focus and readable disabled content, so that I can navigate and copy examples independently.
25. As a user on a smaller screen, I want the scenario selector and code panes to remain usable, so that the manual does not depend on a wide desktop.
26. As a returning portal user, I want manual assets and metadata loaded only when needed, so that other portal sections retain their page-loading performance.
27. As an implementer, I want an approved visual reference and written acceptance criteria, so that illustrative generated text is not mistaken for API authority.

## Implementation Decisions

### Layout and content

- Reuse the portal's Apercu fonts, Forge header, blue active navigation, pale surfaces and bordered panels. Preserve RAG, Consumers, Usage, Sources, Knowledge and account controls. Knowledge is selected; no Sources / Use case guide / Language coverage / Review queue subtab row.
- Keep the Consumer Manual heading and “Choose a use case. Tune its policy. Try a query.” subtitle. The left sidebar contains the three audience headings and seven scenario names, with no child descriptions or sidebar sample badges.
- Use one persistent main column: selected scenario title and short description; Expected behavior; Source & category filters; disabled Test bench and Sample output; enabled Code sample. A drawer close button and the grid inventory are not part of this combined design.
- The main selected-scenario Sample preset badge may remain. Remove the repeated audience label, “from policy”, extra explanation under the four behavior labels, result-count prose, the code-section helper tagline, and all API-token entry or display controls in the bench.
- Maintain concise labels such as Up to 3 results, Minimum similarity, English only and Full text included. Values are preset-controlled in this phase, not new range editors. The database-derived dropdowns are the editable policy controls.
- The annotation colors describe editing instructions; they are not part of the shipped UI. The generated image is a layout reference. Synthetic source names, scores and prose within it are not corpus evidence and must not become production fixtures by transcription.

### Scenarios and the current contract

Use the original seven scenarios with these initial single-request examples.
They are sample starting points, not claims of demonstrated corpus quality.
Omitted language means any language; omitted minimum score retains the API default.

| Group          | Scenario                   | topK | minScore | language | includeDocument |
| -------------- | -------------------------- | ---- | -------- | -------- | --------------- |
| Seeker         | Evangelistic chat          | 8    | 0.37     | en       | true            |
| Seeker         | Thin-language outreach     | 5    | 0.37     | zh       | false           |
| Believer       | Study companion            | 3    | 0.45     | en       | true            |
| Believer       | Course builder             | 20   | 0.37     | omitted  | false           |
| Ministry / org | Training assistant         | 5    | 0.37     | en       | true            |
| Ministry / org | Coverage audit             | 50   | 0.35     | omitted  | false           |
| Ministry / org | Native-language field team | 10   | 0.37     | zh       | true            |

- Study companion is the initial selection. Selecting another scenario resets its example query and dropdowns to that scenario's initial state; no previous scenario's scope silently carries across. Code-language tab choice may persist for the page session.
- Thin-language outreach shows its native-language first request only. Course builder shows its broad collection request only. Explain any later fallback or deeper follow-up briefly in the scenario description; do not generate or execute a second policy, translation, answer-generation step, or automatic request chain.
- Training assistant explains that the consumer must select its vetted sources. It does not claim that all sources are approved for training, and no source key is hardcoded as vetted merely because it appeared in an old example.
- Preserve all seven current public policy fields: allowedSourceKeys, preferSourceKey, language, category, topK, minScore and includeDocument. No rerank, document-type, audience, confidence or nested filters fields are introduced.
- Explain exact semantics: allowedSourceKeys narrows the caller's token scope; preferSourceKey wins equal-score ties only; language and category constrain eligible documents; topK is an upper bound after dedup; minScore is similarity, not probability; includeDocument adds optional full text while text remains the matched passage. The schema accepts scores from zero to one; the old 0.35 noise observation is not an enforced API floor.
- The current API defaults remain topK 5, minScore 0.37 and includeDocument false. Manual presets do not modify service defaults or consumer records.

### Database-derived options

- Add one app-local read-only metadata port for the manual, implemented by the RAG Postgres adapter and injected into the existing portal boundary by the composition root. A proposed same-origin metadata endpoint is GET /portal/manual/options. Reuse current session/admission authorization on every read; return only option metadata, never corpus text or credentials.
- Derive source choices from normalized sources with searchable embedded documents for the configured model. Return actual source keys and display names. Do not use the Sources page's release snapshot or grouped brand IDs as query identifiers.
- Restrict exposed choices to the portal's configured source-access envelope. In phase one this is the configured default consumer source-key set, not an assertion about a developer's separate API credential. Missing scope configuration fails closed. The public API always applies the actual caller token's scope; in phase two, bench options additionally intersect the dedicated consumer's current scope.
- Derive distinct nonblank categories from searchable document categories, never source defaultCategory, audience headings, hardcoded lists or status snapshots. Category options follow the current allowed-source selection and scenario language. Preserve exact stored values as identifiers; display escaping is separate from identifier normalization.
- Allowed sources is a multi-select with an explicit All permitted sentinel; that sentinel omits allowedSourceKeys. Explicit selections serialize the exact selected keys. An empty explicit selection represents an empty allowlist, not All permitted; show that it returns no results. Do not silently widen it.
- Preferred source is a single choice from the current allowed-source set or None. None omits preferSourceKey. If a scope change makes the preference invalid, clear it with visible feedback. Category Any omits category; an invalidated category is cleared with visible feedback. Removed explicit source selections require user correction before copying; never silently fall back to All permitted.
- Fetch options lazily on entering the manual and on relevant scope/language changes, coalescing duplicate requests. Cancel or ignore stale responses so rapid selection and navigation cannot overwrite the latest state. Use bounded metadata queries, short scoped caching and a database timeout; do not scan corpus text or build metadata during unrelated portal startup. If the option set must be paginated, make the remaining options reachable rather than silently dropping them.
- Show loading, no-source/no-category and unavailable states distinctly. Metadata failure leaves static scenario teaching visible but disables dependent controls and copying until the request can be validated; it must not invent a fallback catalog. Retry is explicit and isolated from other portal sections.

### Request and code generation

- Keep one canonical request state for the selected scenario: query plus policy. Derive visuals, formatted JSON and every language snippet from it. Dropdown changes must update all outputs immediately and atomically.
- The right pane heading is exactly request.json. It contains the full POST body with query and policy, not a bare policy object. Omit unset optional fields; do not send blank strings, sentinel labels or undefined values.
- The left pane contains the selected cURL, TypeScript, Bash or Python program. Each example reads request.json rather than maintaining a second independently editable inline payload. cURL and Bash post its bytes; TypeScript and Python read and send the same JSON. State runtime requirements succinctly in the documentation, including server-side execution for credentialed TypeScript.
- Examples call POST /v1/search with JSON content type and Authorization Bearer. Use a configurable service origin and RAG_API_TOKEN with REPLACE_WITH_YOUR_API_TOKEN as the visible setup placeholder. These are the integrating consumer's variables; neither the bench token nor any actual credential is substituted into generated code.
- Each pane has its own top-right copy icon with distinct accessible names, Copy code and Copy request.json. The first copies only the selected executable example; the second copies only JSON. Remove the shared copy button. Keep success/failure feedback local to the chosen action and provide text selection if the Clipboard API is unavailable.
- Serialize JSON structurally and escape language/shell strings safely. Reading a separate JSON file avoids inserting raw queries into executable shell commands. Never put secrets in query parameters, browser persistence, telemetry or generated output.

### Disabled bench in phase one

- Disable the entire bench interaction area, not just Run query: query editing, submission by keyboard, Results / Raw JSON toggles, citation navigation and full-document controls. Use native disabled controls and suppress inactive link actions while leaving sample text readable to assistive technology; do not make the whole sample region inert or hide it from the accessibility tree. A Coming soon label explains the state without exposing environment or credential implementation details.
- Keep a small deterministic synthetic sample result fixture under Sample output. It is visual placeholder content, not a search response and not recomputed to pretend selected filters ran. Use obviously synthetic citations and authored fixture text, never production corpus extracts. The disabled example query may update on scenario selection, but cannot be edited in this phase.
- No browser, server or background search request is made from this page. Do not implement a dormant query-execution endpoint, provision a consumer/key, or add live execution environment wiring under this ticket. Working metadata reads are the explicit exception: they provide dropdown options only.
- Code tabs, independent copy actions, sidebar navigation and source/category controls sit outside the disabled region and remain usable. Runtime sample removal and capability-driven enabling belong to phase two.

## Testing Decisions

- Prefer the existing authenticated portal browser journey as the highest feature boundary. Exercise the real page and a disposable local Postgres corpus through the portal harness; do not recreate the feature's state transitions in isolated mock-only tests.
- Prior art is the portal management/registry/source browser suites, session/admission HTTP tests, and existing Postgres adapter integration suites. Extend those patterns for metadata authorization and persistence truth; add a narrow adapter test only where the browser journey cannot prove a database boundary.
- Insert a synthetic searchable source/category that is absent from the registry and old mockup. It must appear. An unembedded source, a blank category and an out-of-scope source must not. This proves database derivation instead of freezing a hardcoded enumeration in tests.
- Verify all seven scenarios, the initial selection, source multi-select, preference/category invalidation, empty allowlist semantics, errors/retry and out-of-order metadata responses. Test sign-out or removal while the view is open and navigating away during a pending load.
- Exercise all four code tabs and both clipboard controls. Parse copied JSON with the shared request schema; run copied programs against a local capture server with synthetic credentials and assert the same method, headers and request body. Include apostrophes, quotes, backslashes and Unicode in test input. Do not call a live embedding provider or production retrieval service.
- Instrument the authenticated boundary and network during the browser journey: scenario selection, metadata changes, Enter, disabled Run and sample controls must make zero search/embedding calls or usage admissions. Prove metadata reads cannot mutate corpus rows and reject unauthenticated/removed sessions.
- Verify keyboard selection, focus, accessible names and disabled behavior, plus a narrow viewport and long source/category names. Compare the real page against the approved layout; generated image text is not the semantic oracle.
- Measure cold portal navigation, lazy manual resources, metadata latency and transferred bytes with the same local fixture and conditions before and after. Record results for an unrelated portal section too. Investigate a measurable regression; visual smoke is not a substitute for page-load evidence.
- The test-boundary choice is presented to Jaco for confirmation as required by the to-spec workflow. Record any accepted change in the implementation handoff before work starts.

## Out of Scope

Live query execution, enabling the bench, creating or rotating its API token,
creating its dedicated consumer, configuring Railway execution variables, real
usage admission, LLM-generated answers, translation, automatic multi-pass search,
new public retrieval fields, source ingestion, corpus edits, and production
deployment. All deferred bench work is preserved in the companion spec/ticket.

## Further Notes

- Tracker: [feat-575](../roadmap/rag/feat-575-rag-consumer-manual.md), tagged ready-for-agent. The exact implementation entry points and commands live in that roadmap ticket.
- Follow-up: [feat-576](../roadmap/rag/feat-576-rag-governed-test-bench.md) and [execution spec](2026-09-30-002-rag-governed-test-bench-spec.md).
- Historical design seed: [jesusfilm-rag issue 98](https://github.com/JesusFilm/jesusfilm-rag/issues/98). The user's annotated A/D combination and this spec supersede the older layouts, invented fields and illustrative values.
- Current-state reference: Forge main at 761b33714. The public contract and current RAG architecture take precedence over legacy glossary wording that still calls the service external.
- Jaco approved the [combined A/D mockup](../roadmap/rag/evidence/feat-575/consumer-manual-combined.png) on 2026-09-30 as an implementer layout reference. Approval of the image does not authorize query execution or production credential configuration.
