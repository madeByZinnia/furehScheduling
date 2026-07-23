---
name: worktree-per-feature
description: All feature work must be done in a dedicated git worktree, never on the main checkout
metadata:
  type: feedback
---

All implementation work should be done in a dedicated git worktree, not in the
primary `main` checkout. The repo convention is `.worktrees/<name>` on a
`feat/<name>` branch off `main` (e.g. `.worktrees/backend-slice`,
`.worktrees/m1-spa`, `.worktrees/m4-map`).

**Why:** keeps the primary `main` working tree clean and lets parallel feature
lines proceed without stepping on each other; matches how every prior milestone
in this project was built.

**How to apply:** before editing/installing/testing for a feature, create the
worktree (`git worktree add .worktrees/<name> -b feat/<name> main`) and do all
work there. Do not run `npm install` or edits in the main checkout — a stray
install there (e.g. leaflet during M4 planning) dirties `main` and must be
reverted.
