# AI Config Agent Guide

Scope: `packages/ai-config`.

## Rules

- Treat versions as immutable.
- Add new prompt/policy/eval versions instead of mutating old ones.
- Keep policy identifiers stable for auditability.
