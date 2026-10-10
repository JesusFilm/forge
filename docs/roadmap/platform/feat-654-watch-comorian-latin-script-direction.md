---
id: "feat-654"
title: "Keep Latin-script Comorian Watch pages left-to-right"
owner: "vlad"
priority: "P2"
status: "complete"
start_date: "2026-10-08"
duration: 1
depends_on: []
blocks: []
tags:
  - web
  - watch-page
  - i18n
---

## Problem

ICU/CLDR infers Arabic script for the un-scripted `zdj` and `swb` language tags, so Watch's root document direction becomes RTL for the Latin-script Shingazidja and Shimaore variants.

## Entry Points

- `apps/web/src/lib/locale.ts`
- `apps/web/src/lib/locale.test.ts`

## What To Build

- Keep inferred direction LTR for `zdj` and `swb` when no script subtag is supplied.
- Honor explicit script subtags, including RTL scripts.
- Leave locale identity, language metadata, public routes, and other direction decisions unchanged.

## Verification

- Confirm `comorian-shingazidja` resolves to `zdj` and `shimaore` to `swb`, and both return LTR.
- Confirm explicit Arabic-script tags for those languages remain RTL.
- Run focused locale tests, Web typecheck, lint, and formatting.

## Completion Evidence

- `textDirectionForLocale` returns LTR for Shingazidja (`zdj`) and Shimaore (`swb`) route identities when scripts are omitted, while explicit `Arab` subtags remain RTL.
- Focused locale tests pass (76 tests), Web typecheck passes, and focused ESLint and formatting checks pass.
