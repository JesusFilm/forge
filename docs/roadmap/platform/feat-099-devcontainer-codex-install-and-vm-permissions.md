---
id: "feat-099"
title: "Devcontainer Codex Install And VM Permissions"
owner: "tataihono"
priority: "P1"
status: "complete"
start_date: "2026-04-15"
duration: 1
depends_on: []
blocks: []
tags:
  - "tooling"
  - "infrastructure"
---

## Problem

The devcontainer auto-installs Claude Code, but not Codex. Contributors using the VM-backed devcontainer should get Codex preinstalled with a persistent config that allows full local execution without repeated permission prompts.

## Entry Points — Read These First

1. `.devcontainer/Dockerfile` — image build steps and developer CLI installs
2. `.devcontainer/devcontainer.json` — runtime environment variables and post-create hook
3. `.devcontainer/docker-compose.yml` — persisted home-directory volumes for tool config
4. `.devcontainer/post_install.py` — container-local tool configuration bootstrap
5. `docs/solutions/platform/devcontainer-setup.md` — documented devcontainer patterns for this repo

## Grep These

- `CLAUDE_CONFIG_DIR` in `.devcontainer/`
- `post_install` in `.devcontainer/`
- `bypassPermissions` in `.devcontainer/post_install.py`
- `@openai/codex` in `.devcontainer/`

## What To Build

1. Install the Codex CLI as part of the devcontainer image build.
2. Persist Codex config under a dedicated mounted home directory path.
3. Export `CODEX_HOME` in the container runtime.
4. Extend the post-create script to ensure `~/.codex/config.toml` contains:
   - `approval_policy = "never"`
   - `sandbox_mode = "danger-full-access"`
5. Update the devcontainer solution note so the pattern is discoverable for future tooling changes.

## Constraints

- Do not remove or weaken the existing Claude setup.
- Keep Codex configuration idempotent so rebuilds do not duplicate keys.
- Treat the container VM as the trust boundary; do not add extra sandbox restrictions for Codex inside the container.

## Verification

- Rebuild the devcontainer and run `codex --version`
- Inspect `/home/vscode/.codex/config.toml` and confirm the approval and sandbox values
- Confirm the Codex config persists across container restarts via the compose volume
