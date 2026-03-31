---
id: "feat-032"
title: "Tooling & Developer Experience"
owner: "tataihono"
priority: "P0"
status: "in-progress"
start_date: "2026-02-12"
duration: 47
depends_on: []
blocks: []
tags:
  - "tooling"
---

## Problem

A monorepo with multiple apps and contributors needs consistent tooling: linting, formatting, commit conventions, CI, devcontainer setup, and AI agent workflows. Without this, each app drifts in style and quality, and onboarding is slow.

## Entry Points — Read These First

1. `CLAUDE.md` — project-wide conventions and instructions for AI agents
2. `AGENTS.md` — agent workflow instructions (if present)
3. `.devcontainer/` — devcontainer configuration for consistent dev environments
4. `turbo.json` — Turborepo task configuration
5. `package.json` — root workspace configuration, scripts, and pnpm version
6. `.github/workflows/` — CI workflows

## Grep These

- `commitlint` in root config files — conventional commit enforcement
- `eslint` in root config files — linting configuration
- `prettier` in root config files — formatting configuration
- `"claude"` in `.claude/` — Claude Code agent skills and commands
- `doppler` in config files — secrets management via Doppler

## What Was Built

1. **Linting & Formatting**: Repo-wide ESLint + Prettier rollout with consistent config across all apps.
2. **Commit Conventions**: Commitlint enforcing conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
3. **Turborepo**: Task orchestration for build, dev, lint, and typecheck across the monorepo.
4. **Devcontainer**: Full devcontainer setup with pnpm, Doppler CLI, and all dev dependencies.
5. **AI Agent Workflows**: Claude Code project guide (CLAUDE.md), agent skills (handle-pr-review, forge-workflow), bounded context folder guards, Cursor rules.
6. **Secrets Management**: Migrated app secret sync commands to Doppler.
7. **CI**: GitHub Actions for linting, typechecking, and builds.
8. **Compound Engineering**: Integrated docs/solutions/ for institutional learning capture.

## Verification

- `pnpm lint` — runs across all packages without errors
- `ls .devcontainer/` — devcontainer config exists
- `cat CLAUDE.md` — project conventions documented
- `ls .claude/` — agent skills and commands present
