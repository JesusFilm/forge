---
name: work-loop
description: Kick off and run the compound engineering work loop.
---

# Work Loop

Use this as the default execution path for new tasks.

## Sequence

1. `ce:plan` — define scope, acceptance criteria, and affected packages
2. `ce:work` — implement against the plan
3. `ce:review` — run review agents and resolve findings
4. `ce:compound` — write reusable learnings to `docs/solutions/`

## Quick start prompt

```
Start work loop for: <task>
Scope: <folders/packages>
Acceptance criteria:
- ...
- ...
```

## Guardrails

- Keep one bounded context per PR unless explicitly approved.
- If schema changes in `apps/cms`, regenerate `packages/graphql` in the same PR.
- Prefer shared GraphQL operations in `packages/graphql`; avoid app-inline GraphQL.
- Capture durable patterns into docs during `ce:compound`.
