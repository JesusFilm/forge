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
