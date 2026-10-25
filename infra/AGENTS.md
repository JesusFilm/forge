# Infrastructure Agent Guide

Scope: `infra/`.

## Core model

- This directory holds repo-owned infrastructure definitions that are meant to
  be pointed at by external platforms such as Railway.
- Environment-specific state still lives in the platform dashboard unless a
  service explicitly has config-as-code wired to a file in this directory.
- Secrets never belong in this directory. Use `.env.example` files for names
  and safe defaults only.

## Datadog Agent

- `infra/datadog-agent/` defines the shared production Datadog Agent Railway
  service used by Forge apps for backend APM traces, runtime metrics, and
  syslog-over-UDP application logs.
- Deploy it as a private Railway service named `@forge/datadog-agent` with
  config-as-code path `infra/datadog-agent/railway.toml`.
- Do not generate or document a public Railway domain for the Agent.
- Apps should reach it over Railway private networking with:

```bash
DD_AGENT_HOST=${{@forge/datadog-agent.RAILWAY_PRIVATE_DOMAIN}}
DD_TRACE_AGENT_PORT=8126
DD_AGENT_SYSLOG_PORT=514
```

- Keep the Datadog API key value out of git. The production key is named
  `Forge-production` in Datadog; docs may refer to the key name, never its
  value.

## Datadog Monitors

- `infra/datadog-monitors/` holds Datadog **monitors-as-code**: Monitor API JSON
  payloads plus a `create.sh` that POSTs them. It is a **sibling** of
  `infra/datadog-agent/`, not part of it — that dir is a deployable Railway
  service, so monitor payloads must never enter its build context.
- Apply with `DD_API_KEY` + an application key `DD_APP_KEY`; see that dir's
  `README.md`. As with the Agent, only key **names** belong here, never a value.
- First monitors-as-code convention in the repo; port future monitors here rather
  than hand-creating them in the Datadog UI.

## Verification

- For config-only infrastructure changes, run `git diff --check` and inspect
  the staged diff for accidental secrets.
- When changing an app's observability integration, also run that app's focused
  lint/tests and update `docs/observability/datadog.md` if operator steps
  change.
