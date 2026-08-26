---
title: "Devcontainer setup for pnpm and Turborepo monorepos"
date: 2026-05-18
last_updated: 2026-08-26
category: platform
module: devcontainer
problem_type: developer_experience
component: development_environment
severity: medium
applies_when:
  - "Running Forge development servers inside the Compose devcontainer while browsing them from the Docker host"
  - "Adding or changing a stable application port, dev command listener, or Mastra Studio endpoint"
  - "Preventing development services from being published on host LAN interfaces"
  - "Keeping Docker Compose as the single host-publication mechanism instead of editor port forwarding"
  - "Guarding both authored and normalized Compose configuration against networking drift"
symptoms:
  - "A development server is reachable inside the devcontainer but localhost on the Docker host refuses or times out"
  - "Host access works only while an editor-specific port-forwarding feature is active"
  - "Mastra Studio loads from the host but derives an API address that is not browser-reachable"
root_cause: incomplete_setup
resolution_type: environment_setup
tags:
  - devcontainer
  - docker-compose
  - host-port-publishing
  - loopback-binding
  - local-dev
  - mastra
  - nextjs
  - contract-testing
related_features:
  - feat-423
---

# Devcontainer Setup for pnpm + Turborepo Monorepos

## Pattern

When adding a `.devcontainer/` to a pnpm monorepo, ensure pnpm is installed during the Docker build — not just Node.js. Node 16+ ships with corepack, which manages pnpm without a separate install step.

## Implementation

After installing Node via fnm, enable corepack and activate pnpm:

```dockerfile
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$FNM_DIR" --skip-shell && \
  export PATH="$FNM_DIR:$PATH" && \
  eval "$(fnm env)" && \
  fnm install ${NODE_VERSION} && \
  fnm default ${NODE_VERSION} && \
  corepack enable && \
  corepack prepare pnpm@latest --activate
```

## Why corepack over direct pnpm install

- Corepack ships with Node — no additional download
- Respects `packageManager` field in root `package.json`
- Pin the version in `corepack prepare` to match `packageManager` in `package.json` for reproducible builds (e.g. `pnpm@9.12.3`)

## Files in this repo

- `.devcontainer/Dockerfile` — build image
- `.devcontainer/devcontainer.json` — VS Code spec (volumes, extensions, env)
- `.devcontainer/post_install.py` — post-create: Claude bypassPermissions, Codex full-access config, tmux, gitignore
- `.devcontainer/.zshenv` — FNM and Node paths for interactive and non-interactive SSH commands
- `.devcontainer/.zshrc` — zsh config with fnm, fzf, history

## System packages

- PostgreSQL client tools come from the official PGDG apt repository and install `postgresql-client-18`. Ubuntu 24.04's default `postgresql-client` package resolves to PostgreSQL 16, which cannot read custom-format dumps with header version 1.16 from newer Railway PostgreSQL backups.
- The local database sidecar uses `pgvector/pgvector:pg18` to match the Railway PostgreSQL 18 production major version as closely as practical in local development.
- PostgreSQL 18 Docker images expect the persistent volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`, so the Compose volume is named `pgdata18` and mounted at `/var/lib/postgresql`.
- After rebuilding the devcontainer, verify `pg_restore --version`, `pg_dump --version`, and `psql --version` all report PostgreSQL 18 before restoring production backup artifacts.
- PostgreSQL major-version upgrades cannot reuse an old data directory. Old `pgdata` volumes created with PostgreSQL 16 are intentionally not reused by the PG18 sidecar.

### Resetting a PostgreSQL 16 development volume

The `pgdata18` name deliberately starts PostgreSQL 18 with a new data
directory; do not rename it back to `pgdata` or mount it at
`/var/lib/postgresql/data`. Rebuild the devcontainer, apply Admin migrations to
the new database, and then restore a snapshot.

The old PostgreSQL 16 volume is not removed automatically. To reclaim it, stop
the development Compose project, list only volumes carrying its old Compose
volume label, inspect the exact candidate, and remove that exact local-only
volume after confirming it contains no data you need:

```bash
docker compose -f .devcontainer/docker-compose.yml down
docker volume ls --filter label=com.docker.compose.volume=pgdata
docker volume inspect <exact-old-pgdata-volume>
docker volume rm <exact-old-pgdata-volume>
```

Never use a broad volume prune for this reset. After rebuilding, verify the
supported toolchain and sidecar explicitly:

```bash
pg_restore --version
pg_dump --version
psql --version
docker compose -f .devcontainer/docker-compose.yml exec db \
  psql -U forge -d forge -Atqc \
  "select current_setting('server_version'), extversion from pg_extension where extname = 'vector';"
```

## Host access to development servers

The `app` service publishes every stable application port on the Docker host's
IPv4 loopback interface. Use these URLs from a browser or HTTP client on the
host machine after starting the corresponding process inside the devcontainer:

| Service               | Port | Host URL                |
| --------------------- | ---: | ----------------------- |
| Web                   | 3000 | `http://localhost:3000` |
| Manager               | 3002 | `http://localhost:3002` |
| Admin                 | 3003 | `http://localhost:3003` |
| Auth                  | 3004 | `http://localhost:3004` |
| Mastra Gateway        | 3005 | `http://localhost:3005` |
| YouTube Mapper        | 3010 | `http://localhost:3010` |
| Crop Worker           | 3011 | `http://localhost:3011` |
| Shorts Worker         | 3012 | `http://localhost:3012` |
| Roadmap               | 3100 | `http://localhost:3100` |
| Chat                  | 3200 | `http://localhost:3200` |
| Mastra Studio and API | 4111 | `http://localhost:4111` |

Three separate network boundaries make this work:

1. The process must listen on a container-reachable address, not container
   loopback. Each Next.js command pins `0.0.0.0`; the worker HTTP servers keep
   Node's omitted-host, all-interface default; Compose sets `HOST=0.0.0.0` for
   Mastra.
2. Compose publishes the same-number container ports only on host
   `127.0.0.1`, for example `127.0.0.1:3003:3003`. This makes them reachable
   from the Docker host without intentionally exposing them on the host LAN.
3. The host browser connects to `localhost:<port>`. Mastra also receives
   `MASTRA_AUTO_DETECT_URL=true`, so Studio derives API requests from the same
   browser origin instead of advertising a container-only address.

The existing SSH publication on `127.0.0.1:2222` established the same
loopback-only host-access pattern. These boundaries need separate checks: a
running container and an open host port do not prove the service can complete a
request. Treat container state, published bindings, process listeners, and an
application-level host request as separate verification layers.

Port publication does not start an application. Run the required `pnpm dev`,
worker dev command, or `pnpm mastra:dev` inside the devcontainer first. Rebuild
or recreate the devcontainer after changing `.devcontainer/docker-compose.yml`;
restarting only the application process does not apply new Docker port
bindings.

Compose is the only repository-configured and supported publication mechanism
for these stable ports. The devcontainer deliberately omits `forwardPorts` and
matching `portsAttributes`, so the supported path does not depend on VS Code or
another editor's forwarding service. The repository contract check rejects
explicit contracted-port `forwardPorts` or `portsAttributes`, host networking,
Compose merge/extends/include indirection, a different devcontainer Compose
target, or any extra `app` port mapping. CI also feeds the normalized Compose
JSON model into the checker so effective publications cannot drift from the
reviewed source contract:

```bash
docker compose -f .devcontainer/docker-compose.yml config --format json \
  | node scripts/check-dev-port-contract.mjs --resolved-compose-stdin
```

The host ports are intentionally fixed. Only one local Compose project can own
them at a time, so a second Forge worktree or devcontainer will fail with an
address-in-use error while the first is running. Stop the first project before
starting the second. Because the bindings use IPv4 `127.0.0.1`, diagnose with
that address even on hosts where `localhost` also resolves to IPv6. With a
remote Docker context, `127.0.0.1` is loopback on the Docker daemon host, not
the developer workstation; use SSH tunnelling or an equivalent secure path
instead of widening the shared bindings.

Use Docker Engine 28.0.0 or newer—including Docker Desktop with a bundled Engine
28.0.0 or newer—when relying on these loopback publications for same-L2 network
isolation. Older Docker Engine releases can allow another machine on the same
layer-2 network to reach ports published to localhost, so the Compose address
alone is not the same security boundary on those versions.

### Raw `docker run` usage

Compose owns the published-port contract. If an image has been tagged
`forge-dev:local`, starting it directly requires the equivalent environment and
explicit loopback mappings (plus the volumes and other options needed by the
development image):

```bash
docker run \
  -e HOST=0.0.0.0 \
  -e MASTRA_AUTO_DETECT_URL=true \
  -p 127.0.0.1:3000:3000 \
  -p 127.0.0.1:3002:3002 \
  -p 127.0.0.1:3003:3003 \
  -p 127.0.0.1:3004:3004 \
  -p 127.0.0.1:3005:3005 \
  -p 127.0.0.1:3010:3010 \
  -p 127.0.0.1:3011:3011 \
  -p 127.0.0.1:3012:3012 \
  -p 127.0.0.1:3100:3100 \
  -p 127.0.0.1:3200:3200 \
  -p 127.0.0.1:4111:4111 \
  forge-dev:local
```

Do not omit `127.0.0.1` from these `-p` arguments: Docker otherwise publishes
the port on every host interface by default.

### Verification

Run the dependency-free contract checks and resolve the Compose model from the
repository root:

```bash
node scripts/check-dev-port-contract.test.mjs
node scripts/check-dev-port-contract.mjs
docker compose -f .devcontainer/docker-compose.yml config --format json \
  | node scripts/check-dev-port-contract.mjs --resolved-compose-stdin
```

With the devcontainer and representative servers running, confirm Docker's
host bindings, the in-container listeners, and end-to-end host access:

```bash
docker compose -f .devcontainer/docker-compose.yml port app 3000
docker compose -f .devcontainer/docker-compose.yml port app 4111

# Run inside the devcontainer.
ss -ltnp | rg ':(3000|3002|3003|3004|3005|3010|3011|3012|3100|3200|4111)\b'

# Run on the Docker host after the corresponding processes have started.
curl --fail http://127.0.0.1:3010/health
curl --fail http://127.0.0.1:3011/health
curl --fail http://127.0.0.1:3012/health
```

The `docker compose port` output should start with `127.0.0.1:`. If Dev
Containers started Compose with an explicit project name, find it with
`docker compose ls` and add `--project-name <name>` to both commands. Finally,
open representative browser surfaces such as `http://localhost:3000`,
`http://localhost:3003`, and `http://localhost:4111`; Mastra Studio and its API
requests should remain on the `http://localhost:4111` origin.

## Local SSH access

- The devcontainer exposes SSH on host port `127.0.0.1:2222` and disables password authentication.
- Set the `vscode` account shell in `/etc/passwd` to `/bin/zsh`; the Docker `SHELL` environment variable and VS Code terminal profile do not control the shell selected by `sshd`.
- Include both `/home/vscode/.fnm` and `/home/vscode/.fnm/aliases/default/bin` in the image `PATH` and mirror them in `~/.zshenv`. OpenSSH resets `PATH` for a fresh login, while zsh reads `.zshenv` for interactive and non-interactive commands; the stable default-alias path therefore makes commands such as `ssh forge node --version` work after container recreation, while interactive zsh can still use FNM's multishell path.
- Preinstall the T3 CLI version expected by the desktop SSH launcher, explicitly allowing the `node-pty` and `msgpackr-extract` install scripts. A cold `npx t3@<version>` download can exceed the desktop bootstrap timeout before the server begins listening on port `3773`.
- Keep `/home/vscode/.ssh` on a named Compose volume so `authorized_keys` survives rebuilds and restarts.
- Generate the SSH host's ED25519 key at container startup and keep `/etc/ssh/host_keys` on a separate named volume. Do not bake host private keys into the image; persisting this volume also prevents host-identity warnings after image rebuilds.
- Have the key-sync helper repair root-owned fresh named volumes with `sudo install`/`chown`; direct helper runs and normal container startup should both work.
- Use the persisted GitHub CLI config volume to discover the authenticated GitHub username, then sync public keys from `https://github.com/<user>.keys` into a clearly marked managed block in `~/.ssh/authorized_keys`.
- The sync step must be idempotent: remove the prior managed block before writing the latest GitHub keys so users can rotate keys without accumulating stale entries.
- For the reusable cross-container recipe, see `docs/solutions/platform/devcontainer-github-ssh-authorized-keys-pattern-20260525.md`.

## Known gaps / watch-outs

- `claude plugin marketplace add` runs during Docker build — requires public plugins or pre-auth
- Codex CLI can be installed with `npm install -g @openai/codex`; when the container itself is the trust boundary, set `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` in `~/.codex/config.toml` during post-create so the CLI stays unrestricted across rebuilds.
- Pinned base image digests in Dockerfile ensure reproducible builds; update digests when bumping ubuntu version
- Doppler CLI is installed but opt-in — developers must run `doppler login` after container creation to use it. The container works fine without Doppler configured.
- When adding CLI tools via `curl | sh`, always use `-fsSL` (not `-Ls`) so HTTP errors fail the build instead of piping error pages into the shell
