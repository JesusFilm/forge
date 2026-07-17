---
id: "feat-208"
title: "Devotional Closing — Questions + Guided Prayer"
owner: "vlad"
priority: "P1"
status: "not-started"
start_date: "2026-07-01"
duration: 4
depends_on: []
blocks: []
tags:
  - "ai-pipeline"
---

## Problem

The closing card has reflection questions but no prayer, and the questions need a
higher quality bar.

## Entry Points — Read These First

1. `apps/mastra/src/services/devotional/devotional-writer.ts` — questions generation.
2. `apps/shorts-compositions/src/devotional/DevotionalVideo.tsx` — questions card.

## What To Build

Strong open, specific, non-leading questions. Add a short GUIDED prayer (2–4
sentences) that invites the reader to talk to God about the devo's topic — an
invitation to pray, not a script to recite. Render on the closing card (with the
existing outro hold so it lingers).

## Constraints

Prayer stays an invitation, theologically careful (runs through the safety gate).

## Verification

Closing card shows good questions + a warm guided prayer; passes the safety gate.
