---
artifactType: plan
sourceId: 489
sourceTitle: "chore(tooling): convert repo skills to codex-ready format"
linkedPrs: []
scope: "platform"
---

# Plan Artifact: "chore(tooling): convert repo skills to codex-ready format"

## Objective

The repo provides Codex-ready skill definitions for the existing agent workflows, and any shared skill content no longer relies on non-Codex-only tool references.

## Planned approach

1. Add a `.codex/skills/` directory mirroring the existing repo-local skill workflows.
2. Rewrite the shared workflow text to use `gh` CLI and Codex-compatible conventions instead of unavailable MCP tool names.
3. Keep existing Claude/Cursor files, but align their content where the repo expects shared guidance.

## Validation

- [ ] Audit the repo for skill or command definitions that are not Codex-ready.
- [ ] Add or convert Codex-ready skill definitions for each applicable workflow currently represented in repo-local skills or commands.
- [ ] Remove or rewrite repo-local skill instructions that reference unavailable agent tools when a Codex-ready equivalent is expected.
- [ ] Verify the resulting skill files are internally consistent with repo workflow rules.

## References

- AGENTS.md
- CLAUDE.md
- .cursor/skills/
- .claude/commands/

## Source links

- PRs:
- None

## Review notes

- No PR review notes found.
