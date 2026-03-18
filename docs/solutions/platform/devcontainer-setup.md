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
- `.devcontainer/post_install.py` — post-create: Claude bypassPermissions, tmux, gitignore
- `.devcontainer/.zshrc` — zsh config with fnm, fzf, history

## Known gaps / watch-outs

- `claude plugin marketplace add` runs during Docker build — requires public plugins or pre-auth
- Pinned base image digests in Dockerfile ensure reproducible builds; update digests when bumping ubuntu version
- `NPM_CONFIG_IGNORE_SCRIPTS=true` is set for security — may block postinstall scripts in some packages
