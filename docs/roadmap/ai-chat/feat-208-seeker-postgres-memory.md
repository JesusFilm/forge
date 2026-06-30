---
id: "feat-208"
title: "Postgres-persisted Seeker memory + conversation persistence"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-07-10"
duration: 5
depends_on:
  - "feat-205"
blocks:
  - "feat-209"
tags:
  - "ai-pipeline"
  - "infrastructure"
---

## Problem

Seeker memory is in-memory and conversation history is client-side, so both are lost on restart or refresh. Persist them to Postgres for durable multi-turn recall and conversation history.
