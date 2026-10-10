# feat-457 implementation scope

Fixed reviewed prerequisite: e12643ec (root bc070da1). Implements the full approved
Studio agent/instruction/MCP ticket. Native instruction snapshots remain in Mastra
Postgres. Manager owns interactive UI and verified session transport; external MCP
uses Auth resource-bound OAuth. Delegated edits retain user attribution and never
receive interactive review, experiment, publication or activation authority.

## Agreed verification seams

The user pre-agreed actual native Postgres lifecycle/resolution/restart, identical
revision-checked edits through UI/hosted/MCP with actor history, unauthorized scopes,
stale revisions, streaming failures, explicit activation and frontend performance.
Use deterministic provider doubles only; paid generation remains458. Test each
slice failure-first at these public boundaries. Run full affected suites, types,
builds and independent Standards/Spec review against the fixed prerequisite.

## Instruction admission

Do not use editor.agent.update for draft bodies: installed0.13.9 auto-activates.
Native agents.createVersion preserves activation. Native prompt storage explicit
selectors honor draft/version selection where editor.prompt.getById does not.
Resolve immutable agent/block snapshots once, render templates from bounded trusted
context, persist their UUIDs/hashes plus effective digest on attempts, and execute
exact effective bytes. Tools/model stay code-owned. Generic native APIs must not
expose this agent or mutate its instruction authority. Persistent activation and
restore are explicit interactive actions. Native drafts/tests never activate.

## Product surfaces

Manager gains lazy-loaded chat and instruction panels. Chat streams text,
diagnostics and proposed revision-bound commands; accepting a proposal uses the
same canonical commands with delegated authority, and undo uses a new checked
revision. External MCP exposes read/edit/guidance/hosted conversation without
review/publish/activation tools. Sources and assets remain455-owned; catalog
staging remains service-only; narration execution stays disabled until458.
