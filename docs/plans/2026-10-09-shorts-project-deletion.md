# Shorts project deletion (feat-630)

Scope: Admin canonical project lifecycle, portable RPC actions, Manager project
list and external MCP. No catalog publication or media deletion.

Use `Short.deletedAt` as a one-way workspace tombstone. The command locks the
project, checks authenticated human ownership, retries an exact receipt, then
checks revision, publication, active attempts and calendar assignments before
setting the tombstone and recording an attributed receipt atomically. Existing
reads and row-lock authoring deny tombstoned projects; database triggers reject
new revision/attempt/approval writes and undoing the tombstone.

The project list confirms a named project and sends its observed revision plus
stable idempotency key. Errors remain visible without removing the card. MCP
exposes `shorts.deleteProject` with existing `shorts:edit` consent and explicit
user-intent guidance, expected revision and idempotency key. Both transports call
the same Admin command; no payload can choose the owner.

Retain revisions, render evidence and shared assets. A published project must be
unpublished interactively first. Active work must finish or be cancelled; calendar
assignments must be removed before deletion. Verify authorization, stale edits,
retries, hidden reads, trigger guards, MCP forwarding and UI/network behavior.
