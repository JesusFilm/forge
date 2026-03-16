---
artifactType: issue
issueNumber: 445
issueTitle: "chore(tooling): add bounded context folder guard rule for AI agents"
issueUrl: "https://github.com/JesusFilm/forge/issues/445"
state: "CLOSED"
closedAt: "2026-03-13T03:19:39Z"
labels: ["chore", "tooling"]
linkedPrs: []
---

# Issue Artifact: #445

## Background

PR #384 demonstrated a dangerous pattern: a mobile-expo feature branch merged `main` (which included web changes from PR #365), then reverted that merge. When the squash-merge landed on `main`, it silently deleted web files (carousel.tsx, BibleQuotesCarousel changes) that belonged to a completely different bounded context. This required a follow-up PR #435 to restore the lost work.

The root cause is that AI agents currently have no enforced guardrail preventing them from modifying files outside the bounded context of the issue they are working on. The existing "one issue = one context" rule in AGENTS.md is descriptive but not prescriptive — it does not tell agents _how_ to check or _what to do_ when cross-context changes are needed.

## Expected outcome

A clear, enforceable rule added to both Claude Code (`CLAUDE.md`) and Cursor (`.cursor/rules/`) that:

1. Maps each issue scope (from the `type(scope): description` title format) to its allowed folder(s).
2. Prohibits file changes outside the mapped folder.
3. Requires agents to create a separate issue and get human confirmation before touching another platform's files.
4. Includes a pre-commit check reminder to catch violations before pushing.

## Acceptance criteria

- [ ] New Cursor rule file `.cursor/rules/bounded-context-folder-guard.mdc` with `alwaysApply: true`
- [ ] Matching section added to `CLAUDE.md` under a new "Bounded context folder guard" heading
- [ ] Rule includes context-to-folder mapping table covering all bounded contexts
- [ ] Rule includes escalation procedure (create issue, link to epic, wait for human confirmation)
- [ ] Rule includes pre-commit staged-file check instruction
- [ ] Both files are consistent in content

## Possible solution(s)

1. Add a mapping table (scope → allowed folders) and 5 enforcement rules:
   - Check scope first
   - No cross-platform changes
   - Shared packages require justification
   - Escalate if another platform needs changes (create issue, confirm with human)
   - Pre-commit file check

## References

- PR #384 — mobile-expo PR that accidentally reverted web changes from PR #365
- PR #435 — follow-up PR that restored the reverted web changes
- [AGENTS.md](AGENTS.md) — existing "one issue = one context" rule (line 15, 29)
- [CLAUDE.md](CLAUDE.md) — "Bounded contexts" bullet in quick reference (line 14)

## Execution summary

- No linked merged PR found.

## Key review notes

- No PR review notes found.
