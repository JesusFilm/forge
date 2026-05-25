# Devcontainer GitHub SSH Authorized Keys Pattern

## Pattern

When a devcontainer should be reachable over local SSH, treat the container VM as the trust boundary and derive `authorized_keys` from the developer's authenticated GitHub account. Persist the GitHub CLI config and `.ssh` directory on named volumes, then run an idempotent key-sync helper before starting `sshd`.

This avoids copying host private keys into the container and gives each developer a familiar key-management path: add or remove public keys in GitHub, then restart or re-run the sync helper.

## When to use this

Use this pattern when:

- A devcontainer needs SSH access from the host or local tools.
- Password SSH should stay disabled.
- Developers already authenticate GitHub CLI inside the container.
- The container home directory or `.ssh` directory is backed by Docker named volumes.

Do not use it for public network SSH exposure. Bind the SSH port to loopback unless there is a separate network access control layer.

## Container prerequisites

Install these packages or features:

- `openssh-server`
- `curl`
- `sudo`
- GitHub CLI as `gh`

With the devcontainers feature system, GitHub CLI can come from:

```json
{
  "features": {
    "ghcr.io/devcontainers/features/github-cli:1": {}
  }
}
```

The image should create a restrictive `sshd` config:

```dockerfile
RUN mkdir -p /run/sshd /etc/ssh/sshd_config.d && \
  printf '%s\n' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PermitRootLogin no' \
    'PubkeyAuthentication yes' \
    'AllowUsers vscode' \
    > /etc/ssh/sshd_config.d/devcontainer.conf
```

Adapt `AllowUsers vscode` to match the container user.

## Key sync helper

Install a helper script in the image:

```dockerfile
RUN cat > /usr/local/bin/sync-github-authorized-keys <<'EOF' && \
  chmod 0755 /usr/local/bin/sync-github-authorized-keys
#!/usr/bin/env bash
set -euo pipefail

authorized_keys="${HOME}/.ssh/authorized_keys"
managed_begin="# BEGIN github.com public keys"
managed_end="# END github.com public keys"

if ! install -d -m 0700 "${HOME}/.ssh" 2>/dev/null; then
  sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0700 "${HOME}/.ssh"
fi

if ! touch "$authorized_keys" 2>/dev/null; then
  sudo touch "$authorized_keys"
  sudo chown "$(id -u):$(id -g)" "$authorized_keys"
fi

chmod 0600 "$authorized_keys"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is not available; skipping automatic SSH authorized_keys setup." >&2
  exit 0
fi

github_user="$(
  gh auth status --hostname github.com 2>&1 |
    sed -nE 's/.*Logged in to github\.com account ([^ ]+).*/\1/p' |
    head -n 1
)"

if [ -z "$github_user" ]; then
  echo "GitHub CLI is not authenticated; run 'gh auth login' inside the devcontainer to enable automatic SSH access." >&2
  exit 0
fi

github_keys="$(
  curl -fsSL "https://github.com/${github_user}.keys" |
    grep -E '^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp[0-9]+|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com) ' || true
)"

if [ -z "$github_keys" ]; then
  echo "No SSH public keys found at https://github.com/${github_user}.keys." >&2
  echo "Add an SSH key to GitHub, then restart the devcontainer to enable local SSH access." >&2
  exit 0
fi

tmp="$(mktemp)"
awk -v begin="$managed_begin" -v end="$managed_end" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$authorized_keys" > "$tmp"

{
  cat "$tmp"
  printf '%s\n' "$managed_begin"
  printf '%s\n' "$github_keys"
  printf '%s\n' "$managed_end"
} > "$authorized_keys"

rm -f "$tmp"
chmod 0600 "$authorized_keys"
EOF
```

The helper intentionally exits `0` when `gh` is missing, unauthenticated, or the GitHub account has no public SSH keys. That keeps container startup usable while still printing the exact remediation.

## Compose wiring

Persist both GitHub CLI auth and SSH state:

```yaml
services:
  app:
    volumes:
      - devcontainer-gh:/home/vscode/.config/gh
      - devcontainer-ssh:/home/vscode/.ssh
    ports:
      - "127.0.0.1:2222:22"
    command: >
      bash -lc "sudo ssh-keygen -A &&
      sudo install -d -m 0755 /run/sshd &&
      sudo install -d -o vscode -g vscode -m 0700 /home/vscode/.ssh &&
      sync-github-authorized-keys &&
      sudo /usr/sbin/sshd &&
      sleep infinity"

volumes:
  devcontainer-gh:
  devcontainer-ssh:
```

Adapt these values per container:

| Value                                  | Replace with                              |
| -------------------------------------- | ----------------------------------------- |
| `vscode`                               | The non-root container user               |
| `/home/vscode`                         | That user's home directory                |
| `127.0.0.1:2222:22`                    | The host loopback port for this container |
| `devcontainer-gh` / `devcontainer-ssh` | Repo-specific volume names                |

## Why named volumes matter

Named volumes solve two separate problems:

- `~/.config/gh` persists `gh auth login`, so the helper can discover the GitHub username after rebuilds.
- `~/.ssh` persists `authorized_keys`, so SSH access keeps working between restarts even if GitHub is temporarily unreachable.

Fresh named volumes may be root-owned when first mounted. Keep both the Compose startup `sudo install -d -o <user>` step and the helper's fallback ownership repair so direct helper runs and normal startup both work.

## Security notes

- Bind SSH to `127.0.0.1`, not all interfaces.
- Keep password and keyboard-interactive auth disabled.
- Do not mount host private SSH keys into the container.
- Use a managed block in `authorized_keys` so manual keys outside the block are preserved.
- Re-running the helper removes the previous managed block before writing current GitHub keys, which handles GitHub key rotation cleanly.
- Public GitHub keys are not secrets, but they do grant access if the matching private key is available to the connecting client.

## Verification

Run these checks before copying the pattern to another container:

```bash
docker compose -f .devcontainer/docker-compose.yml config
docker compose -f .devcontainer/docker-compose.yml build app
docker compose -f .devcontainer/docker-compose.yml run --rm --no-deps app sync-github-authorized-keys
```

Then verify end to end:

```bash
docker compose -f .devcontainer/docker-compose.yml up -d app
ssh -p 2222 vscode@127.0.0.1 true
docker compose -f .devcontainer/docker-compose.yml exec app sed -n '/BEGIN github.com public keys/,/END github.com public keys/p' ~/.ssh/authorized_keys
```

If the helper says GitHub CLI is unauthenticated, run this inside the container and restart the app service:

```bash
gh auth login -h github.com
docker compose -f .devcontainer/docker-compose.yml restart app
```

## Forge reference implementation

- `.devcontainer/Dockerfile` - installs `sync-github-authorized-keys` and locks down SSH auth.
- `.devcontainer/docker-compose.yml` - persists GitHub CLI and SSH volumes, runs the helper before `sshd`.
- `docs/solutions/platform/devcontainer-setup.md` - broader Forge devcontainer setup notes.
