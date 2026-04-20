#!/usr/bin/env python3
"""Post-install configuration for AI-enabled devcontainer.

Runs on container creation to set up:
- Claude settings (bypassPermissions mode)
- Codex settings (danger-full-access with no approval prompts)
- Tmux configuration (200k history, mouse support)
- Directory ownership fixes for mounted volumes
- Chromium binary + stable symlink for chrome-devtools MCP
"""

import contextlib
import json
import os
import subprocess
import sys
from pathlib import Path


def setup_claude_settings():
    """Configure Claude Code with bypassPermissions enabled."""
    claude_dir = Path.home() / ".claude"
    claude_dir.mkdir(parents=True, exist_ok=True)

    settings_file = claude_dir / "settings.json"

    # Load existing settings or start fresh
    settings = {}
    if settings_file.exists():
        with contextlib.suppress(json.JSONDecodeError):
            settings = json.loads(settings_file.read_text())

    # Set bypassPermissions mode
    if "permissions" not in settings:
        settings["permissions"] = {}
    settings["permissions"]["defaultMode"] = "bypassPermissions"

    settings_file.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    print(f"[post_install] Claude settings configured: {settings_file}", file=sys.stderr)


def setup_codex_settings():
    """Configure Codex with full access inside the devcontainer VM."""
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    codex_home.mkdir(parents=True, exist_ok=True)

    config_file = codex_home / "config.toml"
    desired_lines = [
        'approval_policy = "never"',
        'sandbox_mode = "danger-full-access"',
    ]
    desired_keys = ("approval_policy", "sandbox_mode")

    existing_lines: list[str] = []
    if config_file.exists():
        existing_lines = config_file.read_text(encoding="utf-8").splitlines()

    filtered_lines = [
        line
        for line in existing_lines
        if not any(line.strip().startswith(f"{key} =") for key in desired_keys)
    ]

    config_lines = [*desired_lines]
    if filtered_lines:
        config_lines.append("")
        config_lines.extend(filtered_lines)

    config_file.write_text("\n".join(config_lines) + "\n", encoding="utf-8")
    print(f"[post_install] Codex settings configured: {config_file}", file=sys.stderr)


def setup_tmux_config():
    """Configure tmux with 200k history, mouse support, and vi keys."""
    tmux_conf = Path.home() / ".tmux.conf"

    if tmux_conf.exists():
        print("[post_install] Tmux config exists, skipping", file=sys.stderr)
        return

    config = """\
# 200k line scrollback history
set-option -g history-limit 200000

# Enable mouse support
set -g mouse on

# Use vi keys in copy mode
setw -g mode-keys vi

# Start windows and panes at 1, not 0
set -g base-index 1
setw -g pane-base-index 1

# Renumber windows when one is closed
set -g renumber-windows on

# Faster escape time for vim
set -sg escape-time 10

# True color support
set -g default-terminal "tmux-256color"
set -ag terminal-overrides ",xterm-256color:RGB"

# Terminal features (ghostty, cursor shape in vim)
set -as terminal-features ",xterm-ghostty:RGB"
set -as terminal-features ",xterm*:RGB"
set -ga terminal-overrides ",xterm*:colors=256"
set -ga terminal-overrides '*:Ss=\\E[%p1%d q:Se=\\E[ q'

# Status bar
set -g status-style 'bg=#333333 fg=#ffffff'
set -g status-left '[#S] '
set -g status-right '%Y-%m-%d %H:%M'
"""
    tmux_conf.write_text(config, encoding="utf-8")
    print(f"[post_install] Tmux configured: {tmux_conf}", file=sys.stderr)


def fix_directory_ownership():
    """Fix ownership of mounted volumes that may have root ownership."""
    uid = os.getuid()
    gid = os.getgid()

    dirs_to_fix = [
        Path.home() / ".claude",
        Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")),
        Path("/commandhistory"),
        Path.home() / ".config" / "gh",
    ]

    for dir_path in dirs_to_fix:
        if dir_path.exists():
            try:
                # Use sudo to fix ownership if needed
                stat_info = dir_path.stat()
                if stat_info.st_uid != uid:
                    subprocess.run(
                        ["sudo", "chown", "-R", f"{uid}:{gid}", str(dir_path)],
                        check=True,
                        capture_output=True,
                    )
                    print(f"[post_install] Fixed ownership: {dir_path}", file=sys.stderr)
            except (PermissionError, subprocess.CalledProcessError) as e:
                print(
                    f"[post_install] Warning: Could not fix ownership of {dir_path}: {e}",
                    file=sys.stderr,
                )


def setup_global_gitignore():
    """Set up global gitignore and local git config.

    Since ~/.gitconfig is mounted read-only from host, we create a local
    config file that includes the host config and adds container-specific
    settings like core.excludesfile and delta configuration.

    GIT_CONFIG_GLOBAL env var (set in devcontainer.json) points git to this
    local config as the "global" config.
    """
    home = Path.home()
    gitignore = home / ".gitignore_global"
    local_gitconfig = home / ".gitconfig.local"
    host_gitconfig = home / ".gitconfig"

    # Create global gitignore with common patterns
    patterns = """\
# Claude Code
.claude/

# macOS
.DS_Store
.AppleDouble
.LSOverride
._*

# Python
*.pyc
*.pyo
__pycache__/
*.egg-info/
.eggs/
*.egg
.venv/
venv/
.mypy_cache/
.ruff_cache/

# Node
node_modules/
.npm/

# Editors
*.swp
*.swo
*~
.idea/
.vscode/
*.sublime-*

# Misc
*.log
.env.local
.env.*.local
"""
    gitignore.write_text(patterns, encoding="utf-8")
    print(f"[post_install] Global gitignore created: {gitignore}", file=sys.stderr)

    # Create local git config that includes host config and sets excludesfile + delta
    # Delta config is included here so it works even if host doesn't have it configured
    local_config = f"""\
# Container-local git config
# Includes host config (mounted read-only) and adds container settings

[include]
    path = {host_gitconfig}

[core]
    excludesfile = {gitignore}
    pager = delta

[interactive]
    diffFilter = delta --color-only

[delta]
    navigate = true
    light = false
    line-numbers = true
    side-by-side = false

[merge]
    conflictstyle = diff3

[diff]
    colorMoved = default

[gpg "ssh"]
    program = /usr/bin/ssh-keygen
"""
    local_gitconfig.write_text(local_config, encoding="utf-8")
    print(f"[post_install] Local git config created: {local_gitconfig}", file=sys.stderr)


def setup_chrome_devtools_mcp():
    """Provision Chromium for chrome-devtools MCP.

    Uses Playwright's installer because it ships an arm64-native Chromium for
    Linux — Google's Chrome-for-Testing builds are x86_64 only and Rosetta
    inside the container can't satisfy the cross-arch glibc / GTK chain.

    Creates a stable symlink at ~/.cache/chrome-devtools-mcp/chromium-bin
    so the repo's `.mcp.json` does not need to chase Playwright revision
    bumps. The target is the highest-versioned `chromium-*/chrome-linux/chrome`
    under ~/.cache/ms-playwright/. The symlink name avoids `chrome` because
    chrome-devtools-mcp uses a sibling `chrome-profile/` directory at the
    same parent and we don't want to risk a collision. Idempotent: re-running
    on an existing container skips the download and refreshes the symlink to
    whatever is current.
    """
    home = Path.home()
    fnm_bin = home / ".fnm" / "fnm"
    if not fnm_bin.exists():
        print(
            "[post_install] fnm not found, skipping chrome-devtools MCP setup",
            file=sys.stderr,
        )
        return

    # Run `pnpm dlx playwright install chromium` through a login-style bash
    # invocation so fnm exposes node + pnpm on PATH.
    install_cmd = (
        f'eval "$({fnm_bin} env)" && pnpm dlx playwright@latest install chromium'
    )
    try:
        subprocess.run(
            ["bash", "-c", install_cmd],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        print(
            "[post_install] Warning: Playwright chromium install failed; "
            f"chrome-devtools MCP will not work until resolved. {exc.stderr}",
            file=sys.stderr,
        )
        return

    pw_cache = home / ".cache" / "ms-playwright"
    candidates = sorted(
        pw_cache.glob("chromium-*/chrome-linux/chrome"),
        key=lambda p: p.parent.parent.name,
        reverse=True,
    )
    chrome_bin = next((p for p in candidates if p.is_file()), None)
    if chrome_bin is None:
        print(
            "[post_install] Warning: Playwright reported success but no "
            "chromium binary was found under ~/.cache/ms-playwright/",
            file=sys.stderr,
        )
        return

    link_dir = home / ".cache" / "chrome-devtools-mcp"
    link_dir.mkdir(parents=True, exist_ok=True)
    link = link_dir / "chromium-bin"
    if link.is_symlink() or link.is_file():
        link.unlink()
    elif link.exists():
        # A directory at this path is unexpected — bail rather than rm -rf it.
        print(
            f"[post_install] Warning: {link} exists and is not a file/symlink; "
            "leaving alone. Remove it manually to enable chrome-devtools MCP.",
            file=sys.stderr,
        )
        return
    link.symlink_to(chrome_bin)
    print(
        f"[post_install] chrome-devtools MCP chromium ready: {link} -> {chrome_bin}",
        file=sys.stderr,
    )


def main():
    """Run all post-install configuration."""
    print("[post_install] Starting post-install configuration...", file=sys.stderr)

    setup_claude_settings()
    setup_codex_settings()
    setup_tmux_config()
    fix_directory_ownership()
    setup_global_gitignore()
    setup_chrome_devtools_mcp()

    print("[post_install] Configuration complete!", file=sys.stderr)


if __name__ == "__main__":
    main()
