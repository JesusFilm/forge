# 03: Generate draft narration within a durable allowance

**Parent:** [Specification](../spec.md) · planning tracker feat-541

**Status:** approved; published as `feat-544` with `ready-for-agent` readiness.

**What to build:** The agent uses an approved existing voice to generate and attach draft speech without pausing for preliminary script approval. The human later reviews effective script and voice settings before publication.

**Blocked by:** 01 — Connect an external agent and edit the correct project.

## Acceptance criteria

- [ ] Delegated draft generation has its own scoped admission and does not fabricate an interactive script approval or weaken human final approval.
- [ ] One initial generation and one correction pass are available per project authoring cycle, stable across revisions and client sessions. Further allowance requires explicit human authorization.
- [ ] A pass can include multiple speech items. Durable atomic admission prevents concurrent clients, new retry keys, or visual edits from resetting the allowance.
- [ ] Unchanged complete effective speech/voice identities reuse existing audio; visual-only revisions make no additional provider calls.
- [ ] Duplicate/lost responses reuse the accepted result. Ambiguous paid outcomes reconcile rather than blindly calling the provider again.
- [ ] Generated audio attaches atomically with existing linked-timing behavior; a stale completion retains provenance without overwriting newer human edits.
- [ ] Allowance use, remaining correction pass, and verified estimate or pricing-unavailable state are visible to both the agent and reviewer. No $5 default is introduced.
- [ ] Existing music is the default; new music or voice identity creation remains explicit-request-only. New voice cloning is not implemented.
- [ ] Final human review covers complete effective speech and voice settings; delegated generation and inspection do not satisfy publication approval.
- [ ] Provider fakes prove initial generation, correction, exhausted allowance, reuse, races, and recovery without paid calls; any real provider smoke is separately recorded and authorized.

## Test boundary

Authenticated delegated execution through real authoring persistence and fake provider boundary; human final-review integration.
