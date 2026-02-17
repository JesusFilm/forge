---
name: github-setup-forge
description: Sets up the user's GitHub environment for the Forge repo (git identity, auth, remotes). Use when the user asks to set up GitHub, configure git for contributing, or get ready to push/PR. If credentials or login are missing, the agent asks the user for them first, then configures everything.
---

# GitHub Setup for Forge

**Goal:** Set up the user's GitHub for this repo so they can contribute. The agent performs the setup. If anything is missing (e.g. credentials, not logged in), **ask the user for the needed details first**, then run the setup steps. Skip steps that are already done.

## Flow

1. **Check** what is already configured (identity, auth, remotes).
2. **Ask** the user for anything you cannot do or detect (name, email, "please run `gh auth login`", "please add this key to GitHub", token, etc.).
3. **Configure** only what is missing; run the commands yourself where possible.

## 1. Git identity

**Check:** `git config --global user.name && git config --global user.email`. If either is missing or empty:

- **Ask the user:** "What name and email should we use for your Git commits? (Use the email tied to your GitHub account.)"
- **Then run:**
  ```bash
  git config --global user.name "Their Name"
  git config --global user.email "their.email@example.com"
  ```

They can see verified emails at https://github.com/settings/emails.

## 2. Authentication

**Check:** Run `gh auth status`. If not logged in, or the user will use SSH instead, decide:

**Option A – GitHub CLI (for `gh issue create`, `gh pr create`, `gh repo fork`)**

- If `gh auth status` shows not logged in: **Ask the user** to run `gh auth login` in their terminal (browser or token flow) and complete login, then tell you when done. After they confirm, run `gh auth status` again to verify.
- No credentials to store in chat; login is interactive.

**Option B – SSH (for git push/pull)**

- **Check:** `ls ~/.ssh/id_ed25519.pub` (or `id_rsa.pub`). If no key exists, run `ssh-keygen -t ed25519 -C "user@example.com"` (use their email; accept defaults). Then show the public key: `cat ~/.ssh/id_ed25519.pub`.
- **Ask the user:** "Add this key to GitHub: https://github.com/settings/keys → New SSH key. Paste the line above. Tell me when it’s added."
- **Then:** If repo is already cloned, run `git remote set-url origin git@github.com:JesusFilm/forge.git` (or their fork URL with SSH). Test: `ssh -T git@github.com`.

**Option C – HTTPS + token**

- **Ask the user:** "Create a Personal Access Token at https://github.com/settings/tokens (scope `repo`). Do not paste the token into the chat. Instead, in your terminal either (1) run `echo YOUR_TOKEN | gh auth login --with-token` so the token is read from stdin, or (2) set `export GITHUB_TOKEN=your_token` in your shell. Tell me when you've done one of these." Alternatively they can run one `git push` and enter the token when prompted (token stays in their terminal).
- **Then:** Ensure remote is HTTPS. To cache token: `git config --global credential.helper store`; the next push will prompt and store it.

## 3. Fork vs direct push

- **Check:** Use a non-destructive check only—do not perform a real push. Run `git push --dry-run origin main` (or the current branch); if it reports permission denied (403), they need a fork. Alternatively use `git ls-remote --heads origin main` to verify connectivity (read-only). Do not use `git push origin main` as a probe.
- **No write access:** Run `gh repo fork --remote=true` (requires `gh` logged in). This creates their fork, sets `origin` to their fork and `upstream` to JesusFilm/forge. Tell the user: "Fork is ready. Pushing to `origin` will go to your fork; open PRs from there to JesusFilm/forge."
- **Has write access:** Ensure `origin` points to JesusFilm/forge (or their preferred remote). No fork needed.

## 4. Sanity check

After setup, run:

- `gh auth status` (if using gh)
- `git remote -v`
- `git fetch origin` (and `git fetch upstream` if present)

If something fails, **ask the user** for the missing step (e.g. complete login, add key, or provide token), then retry.

## Summary for the user

Confirm what was set: (1) Git identity, (2) auth (gh and/or SSH/HTTPS), (3) remotes (direct or fork). They can now follow the issue-first workflow (see `forge-workflow` or `forge-git-issues-prs` skills).
