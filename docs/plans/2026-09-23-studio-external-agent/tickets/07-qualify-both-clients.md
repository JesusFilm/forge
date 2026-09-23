# 07: Qualify Claude and Codex through the full review loop

**Parent:** [Specification](../spec.md) · planning tracker feat-541

**Status:** approved; published as `feat-548` with `ready-for-agent` readiness.

**What to build:** Prove the complete experience in each supported client and publish an actionable onboarding and release checklist tied to observed behavior.

**Blocked by:** 06 — Create and revise from a broad brief using a portable skill.

## Acceptance criteria

- [ ] For both Claude and Codex, record exact client/version, connection/auth steps, environment, and grants; demonstrate discovery/create/edit/render/inspection/handoff/revision.
- [ ] Each client resumes after a disconnect, handles an expired media capability, and reconciles an intervening human edit without duplicate effects.
- [ ] Demonstrate approved-existing-voice narration and correction/reuse behavior with disclosed fake versus real provider evidence; obtain explicit authorization before any paid qualification.
- [ ] Record output-ready, evidence-ready, inspection-complete, and repair timings separately with short duration, cut count, network/worker conditions, and warm/cold state.
- [ ] Prove humans can review and approve the intended exact result while agents remain unable to approve or publish. Publishing a real public video is not required for qualification.
- [ ] Document supported inspection modalities for each client; do not replace real-client proof with a generic JSON-RPC probe.
- [ ] Run scope-appropriate formatting, tests, type/build/schema drift checks, code review, and changed-UI load verification. Capture durable implementation learnings.
- [ ] Prepare normal PR-to-main deployment, required OAuth/configuration/migration steps, renderer release requirements if changed, rollback and smoke checks. No local-code production shortcut.
- [ ] Keep acceptance incomplete if a required client is unavailable; record the exact remaining step without claiming both clients work.

## Test boundary

Two real-client end-to-end runs plus repository checks and review; explicit release evidence.
