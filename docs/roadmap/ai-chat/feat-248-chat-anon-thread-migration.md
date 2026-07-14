---
id: "feat-248"
title: "Anonymous-to-account conversation migration (future consideration)"
owner: "jian wei"
priority: "P2"
status: "not-started"
start_date: "2026-09-15"
duration: 3
depends_on:
  - "feat-241"
blocks: []
tags:
  - "web"
  - "ai-pipeline"
---

## Problem

Conversations held while anonymous persist under an `anon:<uuid>` resource
keyed to a browser cookie. When that person signs in, those threads stay
orphaned: history lists only threads created while signed in. feat-208
accepted this limitation and feat-241 deliberately kept it out of scope.

## Future consideration — not a requirement

This ticket exists so the idea isn't lost; it is not committed work at this
stage and may never be: anonymous ephemerality is a privacy feature ("your
anonymous chats don't follow you"), and migration cuts against it. If picked
up, brainstorm first — consent UX, how much trust the anonymous continuity
cookie can carry, and the migration mechanics are all open.
