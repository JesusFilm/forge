---
date: 2026-10-05
draft_id: "05"
title: "Serve saved recommendations on private Watch previews"
status: published
issue_url: https://github.com/JesusFilm/forge/issues/2570
roadmap: feat-590
draft_blocked_by: ["01"]
---

# 05: Serve saved recommendations on private Watch previews

## Parent

https://github.com/JesusFilm/forge/issues/2565

## What to build

Use saved generations in the real Watch recommendation slot under an authenticated
private preview or isolated test configuration. Reuse the existing layout and
Web-to-Admin boundary. This slice can use complete fixture generations and does
not depend on live model or warehouse access.

The returned cards must be immediately playable in the chosen audio language,
and empty results must behave differently from technical failures.

## Acceptance criteria

- [ ] Watch obtains recommendations from saved Admin results with no request-time model or warehouse call.
- [ ] Current publication, Watch visibility, artwork, playback, display locale, and exact selected audio-language checks apply to both direct choices and precomputed alternatives.
- [ ] The existing layout shows the best eligible saved choices up to six. One card is valid; more than six stored edges remain available for filtering.
- [ ] When no direct or alternative choice survives, the row is hidden and the source/language coverage gap is inspectable. No incumbent recovery is triggered solely because the result is validly empty.
- [ ] On a technical read/delivery failure, attempt the incumbent within the existing total deadline. Return assigned versus actual strategy, generation, and reason distinctly for later measurement. Denied authorization or publication cannot be bypassed by fallback.
- [ ] If both strategies fail, the player remains usable. Recommendation loading stays after the player shell and does not become a render or startup dependency.
- [ ] Reuse compact immutable served snapshots and thin item identity/position bindings, including the inline single-item format and packed multi-item reader compatibility.
- [ ] Private preview traffic is excluded from public experiment evidence and cannot enable public traffic. Existing public selection remains unchanged by default.
- [ ] Route/database tests and browser tests cover one/many/empty results, alternatives, changed audio availability, stale seed navigation, technical fallback, and both-failure behavior.
- [ ] Record page-load/resource or timing evidence alongside visual verification and regenerate typed consumer contracts when changed.

## Implementation context

Use the Watch-to-result boundary up to delivery in this slice. Existing contextual
recovery on empty incumbent results must not accidentally override the experiment's
valid-empty policy. Assignment and visit accounting arrive in the next slice.

## Blocked by

- #2566

## Execution policy

The user approved this ticket breakdown and the parent spec's testing boundaries.
Use GPT-6 Sol development chats and Matt Pocock's implement, tdd, and code-review
skills. Do not invoke Compound Engineering skills, directly or through another
skill; this explicit user instruction overrides that default repository workflow.
Follow the other repository conventions. Development-chat Sol does not replace
the product's Astra model. Work under the orchestrator's integration branch;
public activation remains a separate explicit operation.
