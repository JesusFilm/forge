# Claude Code Devcontainer
# Based on Microsoft devcontainer image for better devcontainer integration
ARG UV_VERSION=0.10.0
FROM ghcr.io/astral-sh/uv:${UV_VERSION}@sha256:78a7ff97cd27b7124a5f3c2aefe146170793c56a1e03321dd31a289f6d82a04f AS uv
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04@sha256:d94c97dd9cacf183d0a6fd12a8e87b526e9e928307674ae9c94139139c0c6eae

ARG TZ
ENV TZ="$TZ"

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install PostgreSQL's official apt repository so client tools can track the
# production dump format instead of Ubuntu 24.04's default PostgreSQL 16 tools.
RUN install -d /usr/share/postgresql-common/pgdg && \
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc && \
  . /etc/os-release && \
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list

# Install additional system packages (base image already includes git, curl, sudo, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
  # Sandboxing support for Claude Code
  bubblewrap \
  socat \
  # Modern CLI tools
  fd-find \
  openssh-server \
  ripgrep \
  tmux \
  zsh \
  # Build tools
  build-essential \
  # PostgreSQL client tools only; server runs in sidecar/Railway containers
  postgresql-client-18 \
  # Redis CLI client (server runs in sidecar container)
  redis-tools \
  # Utilities
  jq \
  nano \
  unzip \
  vim \
  # Network tools (for security testing)
  dnsutils \
  ipset \
  iptables \
  iproute2 \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install git-delta
ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  curl -fsSL "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" -o /tmp/git-delta.deb && \
  dpkg -i /tmp/git-delta.deb && \
  rm /tmp/git-delta.deb

# Install uv (Python package manager) via multi-stage copy
COPY --from=uv /uv /usr/local/bin/uv

# Install fzf from GitHub releases (newer than apt, includes built-in shell integration)
ARG FZF_VERSION=0.67.0
RUN ARCH=$(dpkg --print-architecture) && \
  case "${ARCH}" in \
    amd64) FZF_ARCH="linux_amd64" ;; \
    arm64) FZF_ARCH="linux_arm64" ;; \
    *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
  esac && \
  curl -fsSL "https://github.com/junegunn/fzf/releases/download/v${FZF_VERSION}/fzf-${FZF_VERSION}-${FZF_ARCH}.tar.gz" | tar -xz -C /usr/local/bin

# Install Doppler CLI (secrets management)
RUN curl -fsSL --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh

# Create directories and set ownership (combined for fewer layers)
RUN mkdir -p /commandhistory /workspace /home/vscode/.claude /home/vscode/.codex /opt && \
  touch /commandhistory/.bash_history && \
  touch /commandhistory/.zsh_history && \
  chown -R vscode:vscode /commandhistory /workspace /home/vscode/.claude /home/vscode/.codex /opt

# SSH uses the account shell from /etc/passwd; align it with the VS Code terminal.
RUN usermod --shell /bin/zsh vscode

RUN rm -f /etc/ssh/ssh_host_* && \
  mkdir -p /run/sshd /etc/ssh/sshd_config.d && \
  printf '%s\n' \
    'HostKey /etc/ssh/host_keys/ssh_host_ed25519_key' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PermitRootLogin no' \
    'PubkeyAuthentication yes' \
    'AllowUsers vscode' \
    > /etc/ssh/sshd_config.d/forge-devcontainer.conf

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
  echo "GitHub SSH key settings: https://github.com/settings/keys" >&2
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

# Set environment variables
ENV DEVCONTAINER=true
ENV SHELL=/bin/zsh
ENV EDITOR=nano
ENV VISUAL=nano

WORKDIR /workspace

# Switch to non-root user for remaining setup
USER vscode

# Keep fnm and its default Node version available to interactive shells and
# non-interactive SSH commands such as `ssh forge node --version`.
ENV PATH="/home/vscode/.fnm:/home/vscode/.fnm/aliases/default/bin:/home/vscode/.local/bin:$PATH"

# Install Claude Code natively with marketplace plugins
RUN curl -fsSL https://claude.ai/install.sh | bash && \
  claude plugin marketplace add anthropics/skills && \
  claude plugin marketplace add trailofbits/skills && \
  claude plugin marketplace add trailofbits/skills-curated

# Install Python 3.13 via uv (fast binary download, not source compilation)
RUN uv python install 3.13 --default

# Install ast-grep (AST-based code search)
RUN uv tool install ast-grep-cli

# Install fnm (Fast Node Manager), Node 24, pnpm, Codex CLI, and T3 CLI
ARG NODE_VERSION=24
ARG T3_VERSION=0.0.33
ENV FNM_DIR="/home/vscode/.fnm"
RUN curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$FNM_DIR" --skip-shell && \
  export PATH="$FNM_DIR:$PATH" && \
  eval "$(fnm env)" && \
  fnm install ${NODE_VERSION} && \
  fnm default ${NODE_VERSION} && \
  corepack enable && \
  corepack prepare pnpm@9.12.3 --activate && \
  npm install -g @openai/codex@latest && \
  npm install -g --allow-scripts=node-pty,msgpackr-extract "t3@${T3_VERSION}"

# Install Oh My Zsh
ARG ZSH_IN_DOCKER_VERSION=1.2.1
RUN sh -c "$(curl -fsSL https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -x

# Copy zsh configuration
COPY --chown=vscode:vscode .zshenv /home/vscode/.zshenv
COPY --chown=vscode:vscode .zshrc /home/vscode/.zshrc.custom

# Append custom zshrc to the main one
RUN echo 'source ~/.zshrc.custom' >> /home/vscode/.zshrc

# Copy post_install script
COPY --chown=vscode:vscode post_install.py /opt/post_install.py
