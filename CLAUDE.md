# html-notes: notes for agents

Read `README.md` for usage. Build history is in git log; open work is in `yx`. `html-notes-spec.md` is the original spec.

## What the HTML files are

The files this tool serves are project-overview documents that Jess's agents generate. She controls them and the instructions for generating them. So:

- The tool may require things of these files, limit what they can contain, and reformat or rewrite them. Rewriting on disk is expected.
- When a file shape causes trouble, normalize it into a shape the tool handles. Don't try to support every HTML a browser would accept. Example: a page without `<html>`/`<head>`/`<body>` gets them added by the formatter.
- If a requirement can't be met by normalizing, add it to the agent instructions in `README.md`.

## Gotchas

- linkedom doesn't create a missing `<html>`/`<head>`/`<body>`. It makes the first element the root, and reading `document.head` or `document.body` silently creates empty ones inside that root. Go through `parse()`, never `parseHTML` directly.
- GET normalizes the file in place. To try the server by hand, serve a temp copy of `test/fixtures`, not the directory itself. `try-me.html` at the root is Jess's page for hand-testing; she may have uncommitted edits in it, so don't commit or reset it.
- When a worktree session blocks a Bash command as "too complex to verify", split it into plain commands, and put helper scripts in `$CLAUDE_JOB_DIR/tmp` and run them with `node <file>`.
- In the Chrome extension, a click right after `navigate` can land before the client script runs. Wait a second first.

## Task tracking: use `yx`

This project tracks work with `yx`, a git-backed TODO CLI (`yx help` for full command list). Don't use TaskCreate/TaskUpdate for durable project work — those are session-scoped. Use `yx` instead so tasks persist across sessions and machines.

- `.yaks` is gitignored (required for `yx` to run at all — it'll error and tell you to fix this if it isn't).
- The yak history itself lives in git notes (`refs/notes/yaks`), not in `.yaks`, so it travels with the repo via `yx sync`.

Common commands:

- `yx list` — show the current tree (add `--ready` to see only actionable, unblocked yaks; `--format json` for scripting)
- `yx show <id>` — see details/context for one yak
- `yx add "name" [--under <parent-id>] [--context "..."]` — add a yak, optionally nested
- `yx start <id>` — mark as in-progress (wip)
- `yx done <id>` — mark complete
- `yx context <id>` — view a yak's freeform notes
- `yx context <id> <<< "All the context" ` — write the freeform notes
- `yx reset` — rebuild `.yaks` (the local cache) from the git event store (git notes). Use this in a worktree to pick up updates made on main. Use this after returning to main to see updates made while on a worktree.

When starting a new piece of work in this repo, check `yx reset; yx list --ready` first before assuming what's next. When finishing a piece of work, mark the corresponding yak `done` rather than just leaving it.

### Create yaks liberally

Whenever you discover something that we should do, but right this instant is not the time to do it, add a yak!

Whenever the user mentions something additional to do, before you start investigating, add a yak!

When you want the human to do something, make me a yak! Start the name with 👩🏽‍🦱 so that I can tell it's a job for a human.
