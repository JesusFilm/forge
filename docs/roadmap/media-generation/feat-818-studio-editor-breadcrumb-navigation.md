---
id: "feat-818"
title: "Remove redundant Studio editor back button"
owner: "tataihono"
priority: "P2"
status: "complete"
start_date: "2026-10-19"
duration: 1
depends_on: []
blocks: []
tags: [manager, studio, ui]
---

## Problem

The editor toolbar's back arrow duplicates navigation directly above it in the
Manager shell breadcrumb.

## Entry Points — Read These First

1. `apps/manager/src/features/video-studio/editor.tsx` — editor header.
2. `apps/manager/src/features/shell/manager-shell.tsx` — breadcrumb navigation.

## Grep These

- `ArrowLeft|Back to projects|nle-editor-header`

## What To Build

Remove the editor header's back link and unused arrow import. Retain the
unavailable-project recovery link and shell breadcrumb.

## Constraints

No editor state, preview, media, routing or breadcrumb changes.

## Verification

Check the header no longer renders the back link, verify the recovery link
remains, and run scoped ESLint and Prettier. This removes an icon and link with
no new dependencies, requests or initialization work.

## Verification Evidence

Scoped ESLint, Prettier and diff whitespace checks pass. The editor header link
and arrow import are removed; the unavailable-project recovery link remains.
The running remote development server rebuilt the editor successfully.
