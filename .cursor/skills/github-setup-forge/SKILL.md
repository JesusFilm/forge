---
name: github-setup-forge
description: Guides the user to set up GitHub in their environment for the Forge repo (git identity, auth, remotes). Use when the user asks to set up GitHub, configure git for contributing, or get ready to push/PR to this project.
---

# GitHub Setup for Forge

Use when the user wants to contribute to this repo and needs GitHub/env setup. Walk through only the steps that are still needed (e.g. skip identity if already set).

## 1. Git identity

Required for commits to be attributed correctly.

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

Use the email associated with their GitHub account. They can check at https://github.com/settings/emails.

**Verify:** `git config --global user.name && git config --global user.email`

## 2. Authentication

**Option A – SSH (recommended)**

- Generate key: `ssh-keygen -t ed25519 -C "their.email@example.com"` (accept default path; passphrase optional).
- User adds the **public** key to GitHub: https://github.com/settings/keys → New SSH key, paste contents of `~/.ssh/id_ed25519.pub`.
- Set or fix remote to SSH:
  - If repo already cloned: `git remote set-url origin git@github.com:JesusFilm/forge.git`
  - If cloning fresh: `git clone git@github.com:JesusFilm/forge.git`
- Test: `ssh -T git@github.com` (should greet their username).

**Option B – HTTPS + token**

- Remote: `https://github.com/JesusFilm/forge.git` (or their fork URL).
- GitHub no longer accepts account password for push. They need a Personal Access Token: https://github.com/settings/tokens → Generate new (classic), scope `repo` (and `workflow` if they need to re-run CI).
- When pushing, use the token as the password. To cache: `git config --global credential.helper store` (then one push with token stores it).

## 3. Fork vs direct push

- **Has write access to JesusFilm/forge:** Push branches to `origin` and open PRs from that repo. Ensure `origin` points to `JesusFilm/forge` (or their preferred fork they push to).
- **No write access:** They must fork on GitHub, then:
  - Clone **their fork**: `git clone git@github.com:THEIR_USERNAME/forge.git`
  - Add upstream: `git remote add upstream git@github.com:JesusFilm/forge.git`
  - Branch from upstream: `git fetch upstream && git checkout -b feat/123-slug upstream/main`
  - Push to **their fork**: `git push -u origin feat/123-slug`
  - Open PR on GitHub: base = `JesusFilm/forge` `main`, compare = their fork branch.

## 4. Quick sanity check

- `git remote -v` — confirm `origin` (and if used, `upstream`) point to the right repos.
- `git fetch origin` (and `git fetch upstream` if applicable) — no auth errors.
- Optional: `gh auth status` if they use GitHub CLI.

## Summary to give the user

After setup they should have: (1) `user.name` and `user.email` set, (2) push/pull working via SSH or HTTPS+token, (3) correct remotes for either direct push or fork workflow. Then they can follow the project’s issue-first workflow (see `forge-workflow` or `forge-git-issues-prs` skills).
