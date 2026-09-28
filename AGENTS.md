# Project Rules

## Git: commit and push after every task

After completing **any** task in this repo, always finish with a git commit and push. No exceptions.

1. `git status` and `git diff` — review exactly what changed.
2. `git add` only the intended files. Never stage secrets, `.env`, or API keys.
3. `git commit -m "<concise message>"` matching the repo's style (see `git log --oneline`).
4. `git push origin <current-branch>`.

Rules:
- Never amend, force-push, rewrite history, or change git config.
- If a commit fails due to hooks, fix the issue and make a new commit — do not `--amend` or skip hooks.
- If there is nothing to commit, skip silently.
- Only stage files related to the current task; leave unrelated user changes untouched.
