# html-notes: notes for agents

Read `README.md` for usage. Build history is in git log; open work is in `yx`. `html-notes-spec.md` is the original spec. `OVERVIEW.html` is the picture of the project for humans: architecture now and planned. `PLAN.html` is the path: order of work, what's decided, what's blocked. When a change alters the architecture or lands something marked directional there, update it in the same commit and tell Jess.

## Where the code lives

The code lives here. A built output is vendored into the iterate-on-docs plugin at `~/code/jessitron/iterate-on-docs/html-with-comments/`, and that copy is the one Jess runs day to day. Don't edit the copy; change it here, merge to main, then run `./deploy` (see README, "Deploy"). `iterate-on-docs/html-with-comments/VENDORED.md` records which commit it came from. A change to the README's "Contract with iterate-on-docs" table needs a matching edit to the iterate-on-a-document skill. The tool's name is changing to html-revisor (yak); until then it's called html-notes in the code and html-with-comments in directory names.

The domain word for an `<!-- @AI: ... -->` request is **directive**. Avoid note, comment, annotation ("HTML comment" still means the syntax).

## What the HTML files are

The files this tool serves are project-overview documents that Jess's agents generate. She controls them and the instructions for generating them. So:

- The tool may require things of these files, limit what they can contain, and reformat or rewrite them. Rewriting on disk is expected.
- When a file shape causes trouble, normalize it into a shape the tool handles. Don't try to support every HTML a browser would accept. Example: a page without `<html>`/`<head>`/`<body>` gets them added by the formatter.
- If a requirement can't be met by normalizing, add it to the agent instructions in `README.md`.

## Gotchas

- linkedom doesn't create a missing `<html>`/`<head>`/`<body>`. It makes the first element the root, and reading `document.head` or `document.body` silently creates empty ones inside that root. Go through `parse()`, never `parseHTML` directly.
- `vendor/linkedom.mjs` is a generated 480 KB bundle. Don't edit it, and leave `vendor/` out of searches. To read linkedom's source, `npm install` and look in `node_modules/linkedom`. After changing the linkedom version, run `npm run vendor`.
- GET normalizes the file in place. To try the server by hand, serve a temp copy of `test/fixtures`, not the directory itself. `try-me.html` at the root is Jess's page for hand-testing; she may have uncommitted edits in it, so don't commit or reset it.
- When a worktree session blocks a Bash command as "too complex to verify", split it into plain commands, and put helper scripts in `$CLAUDE_JOB_DIR/tmp` and run them with `node <file>`.
- Iterating on a page here (iterate-on-docs) in a background session: edits in the shared checkout get refused, so the loop has to run in a worktree. Enter the worktree before the first turn and start the server on the worktree directory, so Jess's browser saves land where you edit. If you start in the main checkout and move later, commit her turn on main first (the worktree branches from it), then restart the server on the worktree and give her the new URL. When the loop ends, fast-forward main.
- In the Chrome extension, a click right after `navigate` can land before the client script runs. Wait a second first.
- To find directives in a page, grep `'<!-- *@AI:'`, not `'@AI:'`. A page that talks about directives (OVERVIEW.html does) holds the bare prefix in examples. The formatter decodes entities, so escaping can't hide it.
- The formatter puts all of an `<svg>` on one line, and every element inside it can take a directive. Commenting on SVG text works and Jess likes it; see the SVG yak before changing either.

## Task tracking: use `yx`

This project tracks work with `yx`, a git-backed TODO CLI (`yx help` for full command list). Don't use TaskCreate/TaskUpdate for durable project work — those are session-scoped. Use `yx` instead so tasks persist across sessions and machines.

- yx makes each yak directory in `.yaks` read-only, so `git worktree remove` and `rm -rf` fail with "Permission denied" on a worktree that ran `yx`. Run `chmod -R u+w <worktree>` first. The cache is safe to delete; `yx reset` rebuilds it.
- A blocker on a parent yak does not block its children. In yx, children are work toward the parent, so `--ready` lists a blocked parent's children. When a whole stage waits, put the blocker on each child that waits.
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
