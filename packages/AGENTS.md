# Packages Agent Guide

Scope: `packages/*`.

## Rules

- Contracts change first, clients regenerate second.
- No handwritten edits inside generated client outputs.
- Shared models stay small: enums/types only, no hidden runtime behavior.
- Prompt/policy/eval versions are immutable artifacts.
