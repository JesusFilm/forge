# CMS Agent Guide

Scope: `apps/cms`.

## Do

- Model canonical entities and workflow states explicitly.
- Keep AI outputs in variant/revision records.
- Keep transitions auditable and role-gated.

## Do not

- Allow AI path to `published`.
- Move contract definitions out of `packages/contracts`.
