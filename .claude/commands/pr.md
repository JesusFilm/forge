Move current changes to a new branch, commit, push, and open a PR. Then wait for CI to finish.

## Steps

1. **Branch** — Create a new branch from the current branch using conventional naming (`feat/`, `fix/`, `chore/`, `docs/`) based on the nature of the changes. If `$ARGUMENTS` is provided, use it to inform the branch name.

2. **Stage & Commit** — Stage all relevant changed files and create a commit following conventional commits (`feat:`, `fix:`, `chore:`, `docs:`). Write a clear commit message summarizing the changes.

3. **Push** — Push the new branch to origin with `-u` to set upstream tracking.

4. **Open PR** — Create a pull request targeting `main` using `gh pr create`. Before writing the title, run `gh pr list --state all --limit 20` to see recent PR naming conventions and match that format consistently. Include a concise description summarizing the changes.

5. **Wait for CI** — Monitor CI status using `gh pr checks` until all checks complete. Report the final result (pass/fail) with a link to the PR.
