---
id: "feat-207"
title: "Chat app authentication"
owner: "jian wei"
priority: "P1"
status: "not-started"
start_date: "2026-07-07"
duration: 5
depends_on:
  - "feat-205"
blocks:
  - "feat-209"
tags:
  - "web"
  - "infrastructure"
---

## Problem

`apps/chat` has no auth. Integrate `apps/auth` into the chat app so that users can sign in and log out.
