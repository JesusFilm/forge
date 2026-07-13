---
id: "feat-247"
title: "Chat conversation history management (delete/rename)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-09-08"
duration: 2
depends_on:
  - "feat-241"
blocks: []
tags:
  - "web"
  - "ai-pipeline"
---

## Problem

feat-241 ships view/resume-only server history: signed-in users can list and
continue their persisted Seeker conversations but cannot delete or rename
them. Once history reaches real users (feat-236's public phase), management —
especially deleting a sensitive conversation — becomes expected hygiene.

## Stub — flesh out before starting

Deliberately thin placeholder, not committed work. Brainstorm against this
ticket when it is picked up: delete-only vs delete + rename, hard vs soft
delete, confirmation UX, and interplay with the ai-chat retention purge are
all undecided. Expected shape: ownership-gated write route(s) mirroring
feat-241's read-path patterns.
