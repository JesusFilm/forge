# 05: Review an exact draft and revise from conversation feedback

**Parent:** [Specification](../spec.md) · planning tracker feat-541

**Status:** approved; published as `feat-546` with `ready-for-agent` readiness.

**What to build:** The human follows the agent handoff to review an exact render, gives feedback in their existing conversation, optionally makes direct edits, and receives a reconciled revision with accessible prior evidence.

**Blocked by:** 02 — Request and retrieve an exact draft render, 04 — Inspect a rendered draft quickly with attributable evidence.

## Acceptance criteria

- [ ] Handoff includes the exact revision/render, concise change summary, inspection coverage/findings, and a functioning Studio review link.
- [ ] Human can watch the intended render and see whether the current project has advanced; stale output cannot be approved as the new revision.
- [ ] Feedback remains in the external conversation, including optional timestamps. No editor comments database, polling daemon, or automatic client wakeup is introduced.
- [ ] On revision the agent rereads canonical state/history; nonconflicting feedback preserves human edits and creative conflicts are surfaced rather than overwritten.
- [ ] Previous revision/render evidence remains accessible and existing restore mechanisms are usable. A side-by-side comparison editor is not required.
- [ ] Final approval remains an interactive human action for exact bytes and effective script/voice. Agents cannot invoke approval, publication, or destructive commands.
- [ ] Test human edits made before and during agent revision, changed content after inspection, and attempted approval of outdated evidence.
- [ ] If review UI changes, verify browser behavior and page-loading performance using matched fixtures; avoid eagerly loading full evidence packages.

## Test boundary

MCP plus human review UI over real revisions/render records; concurrent edits and approval-staleness integration.
