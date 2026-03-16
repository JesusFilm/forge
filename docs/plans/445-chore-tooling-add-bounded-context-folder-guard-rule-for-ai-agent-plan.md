---
artifactType: plan
sourceIssueNumber: 445
sourceIssueTitle: "chore(tooling): add bounded context folder guard rule for AI agents"
sourceIssueUrl: "https://github.com/JesusFilm/forge/issues/445"
linkedPrs: []
---

# Plan Artifact: #445

## Objective

A clear, enforceable rule added to both Claude Code (`CLAUDE.md`) and Cursor (`.cursor/rules/`) that:

1. Maps each issue scope (from the `type(scope): description` title format) to its allowed folder(s).
2. Prohibits file changes outside the mapped folder.
3. Requires agents to create a separate issue and get human confirmation before touching another platform's files.
4. Includes a pre-commit check reminder to catch violations before pushing.

## Planned approach

1. Add a mapping table (scope → allowed folders) and 5 enforcement rules:
   - Check scope first
   - No cross-platform changes
   - Shared packages require justification
   - Escalate if another platform needs changes (create issue, confirm with human)
   - Pre-commit file check

## Validation

- [ ] New Cursor rule file `.cursor/rules/bounded-context-folder-guard.mdc` with `alwaysApply: true`
- [ ] Matching section added to `CLAUDE.md` under a new "Bounded context folder guard" heading
- [ ] Rule includes context-to-folder mapping table covering all bounded contexts
- [ ] Rule includes escalation procedure (create issue, link to epic, wait for human confirmation)
- [ ] Rule includes pre-commit staged-file check instruction
- [ ] Both files are consistent in content

## Source links

- Issue: [#445](https://github.com/JesusFilm/forge/issues/445)
- PRs:
- None
