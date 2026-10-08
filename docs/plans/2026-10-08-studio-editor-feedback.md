# Studio editor feedback

Scope: rate-aware clips across contracts, Manager editor and shared composition;
component labels/grouping; canvas selection/dragging and vertical sizing.

The root checkout predates the current editor. Implementation uses an isolated
`codex/shorts-studio-feedback-2` checkout of `origin/main` (3795bf7cc).
Existing unrelated local changes remain in the root checkout.

Delivery order: establish synthetic regressions; add portable metadata/rate;
update timing and render consumers; replace full-frame canvas hit targets with
rendered-content hit testing and selected-layer drag; fit Canvas; validate.

Render failure: request the project link/name and inspect retained failure evidence.
A working browser preview does not establish that source materialization, VM execution,
retention or Mux ingestion succeeded. Do not guess a repair from the word “failed”.

No Compound Engineering tool is available; this file records the explicit plan,
with local implementation/review and durable documentation after verification.

Implementation/review complete for items 2–6. Validation and performance evidence:
`docs/validation/studio-editor-feedback/README.md`. Durable learning:
`docs/solutions/ui-bugs/studio-canvas-hit-testing-and-clip-source-time.md`.
The failed export remains unverified in feat-616 pending project identity.
