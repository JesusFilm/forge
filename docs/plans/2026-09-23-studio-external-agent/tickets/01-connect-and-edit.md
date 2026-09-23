# 01: Connect an external agent and edit the correct project

**Parent:** [Specification](../spec.md) · planning tracker feat-541

**Status:** approved; published as `feat-542` with `ready-for-agent` readiness.

**What to build:** An operator connects an existing external client, discovers or opens the intended project, makes an attributed edit, and sees that edit in Studio. Include minimal connection and operating instructions so the slice can be exercised without repository knowledge.

**Blocked by:** None (can start after breakdown approval).

## Acceptance criteria

- [ ] Authenticated MCP initialization and tool discovery work with scoped OAuth; current membership, application environment, consent, and client identity are enforced.
- [ ] Bounded project discovery supports selecting the right project without exposing inaccessible projects; project links can be mapped to exact identities.
- [ ] Create/read/apply/history preserve existing idempotency and expected-revision behavior, and return usable human review links.
- [ ] An external-client edit appears in the editor and history with the authenticated operator and client attribution; another client cannot supply a replacement actor.
- [ ] A human edit racing an agent write returns a recoverable stale-revision result. Reading history and reapplying against the new baseline preserves that human edit.
- [ ] Document and execute connection steps for Claude and Codex, distinguishing client/environment restrictions from server failures. At least one real client completes the editing proof in this slice; the final qualification requires both complete workflows.
- [ ] Read-only tokens, revoked membership, wrong environment, and expired credentials cannot edit. Existing hosted-agent and interactive paths still work.

## Test boundary

MCP authenticated transport and canonical authoring database; real-client edit plus UI observation.
