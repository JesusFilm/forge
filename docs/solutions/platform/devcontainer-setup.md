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
- `.devcontainer/.zshrc` — zsh config with fnm, fzf, history

## System packages

- PostgreSQL client tools come from the official PGDG apt repository and install `postgresql-client-18`. Ubuntu 24.04's default `postgresql-client` package resolves to PostgreSQL 16, which cannot read custom-format dumps with header version 1.16 from newer Railway PostgreSQL backups.
- The local database sidecar uses `pgvector/pgvector:pg18` to match the Railway PostgreSQL 18 production major version as closely as practical in local development.
- PostgreSQL 18 Docker images expect the persistent volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`, so the Compose volume is named `pgdata18` and mounted at `/var/lib/postgresql`.
- After rebuilding the devcontainer, verify `pg_restore --version`, `pg_dump --version`, and `psql --version` all report PostgreSQL 18 before restoring production backup artifacts.
- PostgreSQL major-version upgrades cannot reuse an old data directory. Old `pgdata` volumes created with PostgreSQL 16 are intentionally not reused by the PG18 sidecar.

## Known gaps / watch-outs

- `claude plugin marketplace add` runs during Docker build — requires public plugins or pre-auth
- Codex CLI can be installed with `npm install -g @openai/codex`; when the container itself is the trust boundary, set `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` in `~/.codex/config.toml` during post-create so the CLI stays unrestricted across rebuilds.
- Pinned base image digests in Dockerfile ensure reproducible builds; update digests when bumping ubuntu version
- `NPM_CONFIG_IGNORE_SCRIPTS=true` is set for security — may block postinstall scripts in some packages
- Doppler CLI is installed but opt-in — developers must run `doppler login` after container creation to use it. The container works fine without Doppler configured.
- When adding CLI tools via `curl | sh`, always use `-fsSL` (not `-Ls`) so HTTP errors fail the build instead of piping error pages into the shell
