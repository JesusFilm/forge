---
title: "Never pipe a long-running dev server through an early-exiting consumer (head, grep -m) — it wedges silently and masquerades as an app bug"
date: 2026-07-13
category: developer-experience
module: "local dev / agent ops (any long-running server started from a shell)"
problem_type: developer_experience
component: tooling
severity: medium
applies_when:
  - "Starting a dev server (or any long-running process) as a background shell task"
  - "Piping a background process's output through an early-exiting consumer like head, grep -m, or sed Nq"
  - "A locally-run app suddenly hangs on every request while its process is still alive"
tags: [dev-server, background-task, pipe, head, sigpipe, next-dev, agent-ops]
---

# Never pipe a long-running dev server through an early-exiting consumer (head, grep -m) — it wedges silently and masquerades as an app bug

## Context

During feat-240 verification (this session), the chat dev server was started as a
background task with its output trimmed for readability:

```bash
pnpm --filter @forge/chat dev 2>&1 | head -25   # DO NOT do this
```

Quick curl smokes passed, because the server had logged fewer than 25 lines. Once a
human started clicking around (page compiles, request logging), output passed the
limit, `head` exited, and the pipe lost its reader. The server process stayed alive
— `pgrep` showed `next-server (v16.2.4)` running — but every HTTP request from then
on hung until timeout (`curl` returned code 000 after 8s, even for `/`). The
user-visible symptom was "clicking Log out just sits there spinning", which read as
a bug in the logout change that had just been implemented. It wasn't: the first
request to hit the wedged server simply inherited the hang, and any endpoint would
have shown the same thing.

## Guidance

- **Run background servers bare.** The background-task harness already captures
  stdout to a file; there is nothing for a pipe to add:

  ```bash
  pnpm --filter @forge/chat dev          # output lands in the task's log file
  ```

  Inspect the captured file (or `tail -f` it in a _separate_ command) instead of
  trimming the live stream.

- **If a harness isn't capturing, redirect to a file** (`> /tmp/dev.log 2>&1`) —
  a file never stops reading.

- The failure shape to recognize: a process that is **alive but unresponsive on
  every request** after working fine initially, started via an early-exiting
  consumer — `... | head`, `grep -m`, `sed Nq`. When that consumer exits, the pipe
  has no reader; once the process's buffered output can no longer be flushed, its
  writes stall and request handling stalls with them (observed behavior this
  session — the exact stall point depends on the runtime's stdout handling, but
  the operational rule doesn't). Note `tail -n` is NOT a wedge culprit — it reads
  until EOF and never exits early, so it cannot orphan the pipe; piped from a
  long-running server it just shows nothing until the server dies (useless, but a
  different failure). The alive-but-hung shape is characteristic of runtimes that
  survive a lost pipe reader (Node, as observed here); a process with default
  SIGPIPE disposition (Go binaries, many CLI tools) dies outright on the next
  write instead — presenting as connection-refused, not a hang. The never-pipe
  rule covers both shapes.

- Diagnosis in one command — if the root path also times out, it's the process,
  not your feature:

  ```bash
  curl -s -o /dev/null -w "%{http_code} (%{time_total}s)\n" --max-time 8 http://localhost:3200/
  ```

**One applicability note:** this applies to any long-running foreground-output
process (dev servers, watchers, log streamers), not just Next.js — short-lived
commands piped through `head` are fine, which is exactly why the bug hides during
quick smoke tests and surfaces only under real use.
