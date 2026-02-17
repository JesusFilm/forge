# Contracts Agent Guide

Scope: `packages/contracts`.

## Do

- Keep GraphQL schema explicit and versioned.
- Preserve backward compatibility unless issue explicitly allows breaking change.
- Trigger codegen updates in same PR.

## Do not

- Put implementation code here.
- Encode environment behavior in contracts.
