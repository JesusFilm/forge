# Docker (dev)

Run the Forge monorepo in containers. **Worktree-aware**: use the same setup from the main clone or any git worktree—always run from your current repo root.

## Quick start

From the repo root (main clone or worktree):

```bash
docker compose up --build
```

- **Web**: http://localhost:3000  
- **CMS (Strapi)**: http://localhost:1337  
- **AI orchestrator**: http://localhost:4010  

Run a single app:

```bash
docker compose up web
docker compose up cms
docker compose up ai-orchestrator
```

## Worktrees

The compose file mounts the **current directory** (`.`) as `/app` in the container. So:

- From the **main clone**: `cd /path/to/forge && docker compose up` → main repo is mounted.
- From a **worktree**: `cd /path/to/forge-apps-cms && docker compose up` → that worktree is mounted.

No path changes are required; just run `docker compose` from the directory you’re working in. The first time in a new worktree, `pnpm install` runs inside the container and populates `node_modules` in that directory.

### Optional: git inside the container

In a worktree, `.git` is a file that points at the main repo. If you need to run git (or husky) inside the container, you can mount the main repo’s `.git` directory. Example override:

```yaml
# docker-compose.override.yml (create locally; not committed)
# Set ROOT_WORKTREE_PATH to the main repo path, e.g. /Users/you/forge
services:
  web:
    volumes:
      - ${ROOT_WORKTREE_PATH}/.git:/main-git:ro
  cms:
    volumes:
      - ${ROOT_WORKTREE_PATH}/.git:/main-git:ro
  ai-orchestrator:
    volumes:
      - ${ROOT_WORKTREE_PATH}/.git:/main-git:ro
```

Then run with `ROOT_WORKTREE_PATH=/path/to/main docker compose up`. Using that mount for git inside the container would require extra setup (e.g. config or wrapper) and is optional; most workflows run git on the host.

## Strapi (CMS) and worktrees

If you use `.cursor/worktrees.json` and copy `apps/cms/.tmp` from the main worktree, do that on the host before starting the CMS container, or ensure the same path is available so Strapi can find its data.

## Image

- **Dockerfile.dev**: Node 24, pnpm 9, build tools for native deps (e.g. `better-sqlite3`). No app code is copied into the image; the repo is always mounted at runtime so one image works for every worktree.
